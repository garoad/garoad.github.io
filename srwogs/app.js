// Super Robot Wars OGs Save Editor Web Logic

// ==========================================
// 1. Base64 & Buffer Helpers
// ==========================================
function base64ToBytes(base64) {
  const binString = atob(base64);
  const len = binString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}

// Convert string to SJIS bytes (with ASCII fallback)
function stringToSJIS(str, maxLength) {
  if (typeof Encoding !== 'undefined') {
    try {
      const unicodeArray = Encoding.stringToCode(str);
      const sjisBytes = Encoding.convert(unicodeArray, { to: 'SJIS', from: 'UNICODE' });
      const arr = new Uint8Array(maxLength);
      for (let i = 0; i < Math.min(sjisBytes.length, maxLength); i++) {
        arr[i] = sjisBytes[i];
      }
      return arr;
    } catch (e) {
      console.warn("SJIS encoding failed, falling back to ASCII:", e);
    }
  }
  
  // Fallback ASCII
  const arr = new Uint8Array(maxLength);
  for (let i = 0; i < Math.min(str.length, maxLength); i++) {
    const code = str.charCodeAt(i);
    arr[i] = code < 128 ? code : 63; // Replace non-ascii with '?'
  }
  return arr;
}

class BinaryBuffer {
  constructor(arrayBuffer) {
    this.buffer = arrayBuffer;
    this.data = new Uint8Array(arrayBuffer);
    this.view = new DataView(arrayBuffer);
  }

  // Read Int/Uint
  readUint8(addr) { return this.data[addr]; }
  readInt16(addr) { return this.view.getInt16(addr, true); }
  readUint16(addr) { return this.view.getUint16(addr, true); }
  readInt32(addr) { return this.view.getInt32(addr, true); }
  readUint32(addr) { return this.view.getUint32(addr, true); }

  // Write Int/Uint
  writeUint8(addr, val) { this.data[addr] = val; }
  writeInt16(addr, val) { this.view.setInt16(addr, val, true); }
  writeUint16(addr, val) { this.view.setUint16(addr, val, true); }
  writeInt32(addr, val) { this.view.setInt32(addr, val, true); }
  writeUint32(addr, val) { this.view.setUint32(addr, val, true); }

  // Read bits (1-based startBit, length)
  readBits(addr, startBit, length) {
    const byteVal = this.data[addr];
    const shift = startBit - 1;
    const mask = (1 << length) - 1;
    return (byteVal >> shift) & mask;
  }

  // Write bits (1-based startBit, length)
  writeBits(addr, startBit, length, val) {
    const shift = startBit - 1;
    const mask = (1 << length) - 1;
    let byteVal = this.data[addr];
    byteVal &= ~(mask << shift);
    byteVal |= (val & mask) << shift;
    this.data[addr] = byteVal;
  }

  // Read Shift-JIS string
  readString(addr, maxLen = 1024) {
    let len = 0;
    while (this.data[addr + len] !== 0 && len < maxLen) {
      len++;
    }
    const subArray = this.data.subarray(addr, addr + len);
    try {
      return new TextDecoder("shift-jis").decode(subArray);
    } catch (e) {
      // Fallback decode if browser doesn't support shift-jis decoding
      let res = "";
      for (let i = 0; i < subArray.length; i++) {
        res += String.fromCharCode(subArray[i]);
      }
      return res;
    }
  }

  // Write Shift-JIS string
  writeString(addr, maxLength, str) {
    const bytes = stringToSJIS(str, maxLength);
    for (let i = 0; i < maxLength; i++) {
      this.data[addr + i] = bytes[i];
    }
  }

  // Helper for C# ReadBytesString (convert byte array to Hex String in specific order)
  readBytesHex(addr, len, reverse = false) {
    let hex = "";
    for (let i = 0; i < len; i++) {
      const b = this.data[addr + i];
      const hexByte = b.toString(16).padStart(2, '0').toUpperCase();
      if (reverse) {
        hex = hexByte + hex;
      } else {
        hex += hexByte;
      }
    }
    return hex;
  }

  // Helper for C# WriterBytesString
  writeBytesHex(addr, hexStr, reverse = false) {
    if (hexStr.length % 2 !== 0) return;
    const len = hexStr.length / 2;
    for (let i = 0; i < len; i++) {
      const byteIdx = reverse ? (len - 1 - i) : i;
      const b = parseInt(hexStr.substring(byteIdx * 2, byteIdx * 2 + 2), 16);
      this.data[addr + i] = b;
    }
  }
}

// ==========================================
// 2. Constants & Settings
// ==========================================
const STATUS = {
  scenario: {
    dataName: "BISLPS-25733OGS",
    dataSize: 37888,
    workFileSize: 79360,
    workDataStartAddress: 39936,
    checkSum: 77820,
    checkSumStart: 39936,
    checkSumEnd: 77819,
    defaultCheckSum: 2022987282,
    mask: null // Loaded from SCENARIO_MASK_B64
  },
  system: {
    dataName: "BISLPS-25733OGS",
    dataSize: 156672,
    workFileSize: 171008,
    workDataStartAddress: 12800,
    checkSum: 169468,
    checkSumStart: 12800,
    checkSumEnd: 169467,
    defaultCheckSum: 2022987282,
    mask: null // Loaded from SYSTEM_MASK_B64
  }
};

// Initialize Masks
STATUS.scenario.mask = base64ToBytes(SCENARIO_MASK_B64);
STATUS.system.mask = base64ToBytes(SYSTEM_MASK_B64);

// ==========================================
// 3. Save File Format Detection
// ==========================================
function detectSaveFormat(originalBuffer, saveType) {
  const config = STATUS[saveType];
  const size = originalBuffer.byteLength;
  const view = new DataView(originalBuffer);
  const data = new Uint8Array(originalBuffer);
  
  const readString = (offset, maxLen) => {
    let len = 0;
    while (data[offset + len] !== 0 && len < maxLen && (offset + len) < size) {
      len++;
    }
    return new TextDecoder('shift-jis').decode(data.subarray(offset, offset + len));
  };

  const getBytesHex = (offset, len, reverse = false) => {
    let hex = "";
    for (let i = 0; i < len; i++) {
      const b = data[offset + i];
      const hexByte = b.toString(16).padStart(2, '0').toUpperCase();
      if (reverse) {
        hex = hexByte + hex;
      } else {
        hex += hexByte;
      }
    }
    return hex;
  };

  // 1. Raw BIN format (Exact match to WorkFileSize or DataSize)
  if (size === config.workFileSize) {
    return { format: 'bin_full', startOffset: 0 };
  }
  if (size === config.dataSize) {
    return { format: 'bin_raw', startOffset: 0 };
  }

  // 2. .psv format
  if (size > 86) {
    // PSVFileSizeAddress = 24, PSVFileNameAddress = 64, PSVDataStartAddress = 86
    const psvSize = parseInt(getBytesHex(24, 4, true), 16);
    const psvName = readString(64, 20);
    if (psvSize === config.dataSize && psvName.startsWith(config.dataName)) {
      const dataStart = parseInt(getBytesHex(86, 4, true), 16);
      return { format: 'psv', startOffset: dataStart };
    }
  }

  // 3. .psu format (스캔)
  if (size > 512) {
    let num3 = 512;
    let num4 = 512;
    let startOffset = -1;
    while (num3 < size - 512) {
      const text = getBytesHex(num3, 2, false); // Order=1
      const num = parseInt(getBytesHex(num3 + 4, 4, true), 16); // Order=0
      const text2 = readString(num3 + 64, 64);
      
      if (text === "2784" || text === "2F84" || text === "1784" || text === "9784") {
        if ((text === "1784" || text === "9784") && num === config.dataSize && text2.startsWith(config.dataName)) {
          startOffset = num3 + 512;
          break;
        }
        let alignedNum = num;
        if (alignedNum % 1024 !== 0) {
          alignedNum = alignedNum - (alignedNum % 1024) + 1024;
        }
        num4 = num3;
        num3 = num3 + 512 + alignedNum;
        continue;
      }
      
      const textTemp = getBytesHex(num4, 2, false);
      const numTemp = parseInt(getBytesHex(num4 + 4, 4, true), 16);
      if ((textTemp === "1784" || textTemp === "9784") && numTemp === 0) {
        const textTemp2 = getBytesHex(num4 + 1536, 2, false);
        if (textTemp2 === "2784" || textTemp2 === "2F84" || textTemp2 === "1784" || textTemp2 === "9784") {
          num3 = num4;
          continue;
        }
        break;
      }
      break;
    }
    if (startOffset !== -1) {
      return { format: 'psu', startOffset };
    }
  }

  // 4. .dm2 / .mem format
  if (size > 1024) {
    let num4 = 0;
    // For DM2: scan 5 headers
    try {
      for (let i = 0; i < 5; i++) {
        num4 = num4 + parseInt(getBytesHex(num4, 4, true), 16) + 4;
      }
      num4 += 4;
      num4 += parseInt(getBytesHex(num4, 2, true), 16);
      
      let startOffset = -1;
      while (num4 < size - 4) {
        const text = getBytesHex(num4 + 78, 2, false); // Order=1
        const num = parseInt(getBytesHex(num4 + 66, 4, true), 16); // Order=0
        const text2 = readString(num4 + 2, 64);
        
        if ((text === "8417" || text === "8497") && num === config.dataSize && text2.startsWith(config.dataName)) {
          startOffset = num4 + parseInt(getBytesHex(num4, 2, true), 16);
          break;
        }
        num4 = num4 + parseInt(getBytesHex(num4, 2, true), 16) + num;
      }
      if (startOffset !== -1) {
        return { format: 'dm2', startOffset };
      }
    } catch (e) {}

    // For MEM
    try {
      let num5 = 4 + parseInt(getBytesHex(4, 2, true), 16);
      let startOffset = -1;
      while (num5 < size - 4) {
        const text = getBytesHex(num5 + 78, 2, false);
        const num = parseInt(getBytesHex(num5 + 66, 4, true), 16);
        const text2 = readString(num5 + 2, 64);
        
        if ((text === "8417" || text === "8497") && num === config.dataSize && text2.startsWith(config.dataName)) {
          startOffset = num5 + parseInt(getBytesHex(num5, 2, true), 16);
          break;
        }
        num5 = num5 + parseInt(getBytesHex(num5, 2, true), 16) + num;
      }
      if (startOffset !== -1) {
        return { format: 'mem', startOffset };
      }
    } catch (e) {}
  }

  return null;
}

// ==========================================
// 4. Save Editor Core Class
// ==========================================
class SaveEditor {
  constructor(arrayBuffer, saveType, formatInfo) {
    this.originalBuffer = new Uint8Array(arrayBuffer);
    this.saveType = saveType; // 'scenario' | 'system'
    this.formatInfo = formatInfo; // { format, startOffset }
    this.config = STATUS[saveType];
    
    // Create Work Buffer
    this.workBuffer = new BinaryBuffer(new ArrayBuffer(this.config.workFileSize));
    
    // Extract actual save data and put it in workBuffer
    if (this.formatInfo.format === 'bin_full') {
      // Direct full work buffer copy
      this.workBuffer.data.set(this.originalBuffer);
    } else if (this.formatInfo.format === 'bin_raw') {
      // Direct raw data copy into workDataStartAddress
      this.workBuffer.data.set(this.originalBuffer, this.config.workDataStartAddress);
    } else {
      // Extract from original container
      const sub = this.originalBuffer.subarray(this.formatInfo.startOffset, this.formatInfo.startOffset + this.config.dataSize);
      this.workBuffer.data.set(sub, this.config.workDataStartAddress);
    }

    // XOR Decrypt
    this.applyXorMask();

    // Parse Data Model
    this.dataSet = {};
    this.parseData();
  }

  // XOR Masking / Unmasking (Symmetric)
  applyXorMask() {
    const mask = this.config.mask;
    const len = Math.min(this.workBuffer.data.length, mask.length);
    for (let i = 0; i < len; i++) {
      this.workBuffer.data[i] ^= mask[i];
    }
  }

  // Parse Binary Data into JS Object
  parseData() {
    const wb = this.workBuffer;
    
    if (this.saveType === 'scenario') {
      this.dataSet.title = wb.readUint8(72708);
      
      // 1. Unit DataSet
      this.dataSet.unitDataSet = [];
      let unitOffset = 0;
      for (let i = 0; i < 99; i++) {
        const u = {};
        u.DT_UnitFlag = wb.readBits(Math.floor(i / 8) + 39940, (i % 8) + 1, 1);
        
        let code = wb.readUint16(unitOffset + 42420);
        u.DT_OG2Flag = code >= 1000;
        u.DT_Code = u.DT_OG2Flag ? (code - 1000) : code;
        
        u.DT_KansouBuki = [];
        for (let j = 0; j < 18; j++) {
          u.DT_KansouBuki.push(wb.readUint16(unitOffset + 42422 + j * 2));
        }
        
        u.DT_Parts1 = wb.readUint8(unitOffset + 42458);
        u.DT_Parts2 = wb.readUint8(unitOffset + 42459);
        u.DT_Parts3 = wb.readUint8(unitOffset + 42460);
        u.DT_Parts4 = wb.readUint8(unitOffset + 42461);
        
        u.DT_Sonzai = wb.readUint16(unitOffset + 42462);
        
        u.DT_Buki = [];
        for (let j = 0; j < 32; j++) {
          // 4-bits per weapon upgrade (2 weapons per byte)
          const bIdx = Math.floor(j / 2);
          const bitPos = (j % 2) * 4 + 1; // 1 or 5
          u.DT_Buki.push(wb.readBits(unitOffset + 42467 + bIdx, bitPos, 4));
        }
        
        u.DT_Tama = [];
        for (let j = 0; j < 32; j++) {
          u.DT_Tama.push(wb.readUint8(unitOffset + 42483 + j));
        }
        
        u.DT_Full = wb.readUint8(unitOffset + 42521);
        u.DT_HP = wb.readBits(unitOffset + 42522, 1, 4);
        u.DT_EN = wb.readBits(unitOffset + 42522, 5, 4);
        u.DT_Undou = wb.readBits(unitOffset + 42523, 1, 4);
        u.DT_Soukou = wb.readBits(unitOffset + 42523, 5, 4);
        
        // Pilot Mapping
        // Load pilot indexes (from Pilot mapping area at 39988)
        u.DT_Pilot1 = wb.readUint16(i * 16 + 39988);
        u.DT_Pilot2 = wb.readUint16(i * 16 + 39992);
        u.DT_Pilot3 = wb.readUint16(i * 16 + 39996);
        u.DT_Pilot4 = wb.readUint16(i * 16 + 40000);
        
        this.dataSet.unitDataSet.push(u);
        unitOffset += 106;
      }

      // 2. Bukiko (환장 무기 보관소)
      this.dataSet.bukikoDataSet = [];
      let bukiOffset = 0;
      for (let i = 0; i < 255; i++) {
        const b = {};
        let code = wb.readUint16(bukiOffset + 64820);
        b.DT_OG2Flag = code >= 2000;
        b.DT_Code = b.DT_OG2Flag ? (code - 2000) : code;
        b.DT_Tama = wb.readUint8(bukiOffset + 64822);
        b.DT_Kaizou = wb.readBits(bukiOffset + 64823, 1, 4);
        b.DT_SoubiFlag = wb.readBits(bukiOffset + 64823, 5, 1);
        
        this.dataSet.bukikoDataSet.push(b);
        bukiOffset += 4;
      }

      // 3. Tama (특수탄 데이터)
      this.dataSet.tamaDataSet = [];
      let tamaOffset = 0;
      for (let i = 0; i < 127; i++) {
        const t = {};
        t.Sozai1 = wb.readUint8(tamaOffset + 65844);
        t.Sozai2 = wb.readUint8(tamaOffset + 65845);
        t.Sozai3 = wb.readUint8(tamaOffset + 65846);
        t.Name = wb.readString(tamaOffset + 65848, 21);
        t.Kougeki = wb.readInt16(tamaOffset + 65872);
        t.Syatei = wb.view.getInt8(tamaOffset + 65874);
        t.Meicyu = wb.readInt16(tamaOffset + 65875);
        t.Critical = wb.readInt16(tamaOffset + 65877);
        t.Tama = wb.view.getInt8(tamaOffset + 65879);
        t.Kiryoku = wb.view.getInt8(tamaOffset + 65880);
        t.Tchikei1 = wb.readUint8(tamaOffset + 65881);
        t.Tchikei2 = wb.readUint8(tamaOffset + 65882);
        t.Tchikei3 = wb.readUint8(tamaOffset + 65883);
        t.Tchikei4 = wb.readUint8(tamaOffset + 65884);
        t.Tokusyu = wb.readUint8(tamaOffset + 65885);
        
        t.PZokusei = wb.readBits(tamaOffset + 65886, 1, 1);
        t.Baria = wb.readBits(tamaOffset + 65886, 2, 2);
        t.TokusyuLv = wb.readBits(tamaOffset + 65886, 4, 2);
        t.Sonzai = wb.readBits(tamaOffset + 65886, 6, 1);
        
        this.dataSet.tamaDataSet.push(t);
        tamaOffset += 43;
      }

      // 4. Pilot DataSet
      this.dataSet.pilotDataSet = [];
      let pilotOffset = 0;
      for (let i = 0; i < 99; i++) {
        const p = {};
        p.DT_PilotFlag = wb.readBits(Math.floor(i / 8) + 39956, (i % 8) + 1, 1);
        
        let code = wb.readUint16(pilotOffset + 55988);
        p.DT_OG2Flag = code >= 1000;
        p.DT_Code = p.DT_OG2Flag ? (code - 1000) : code;
        
        p.DT_Sonzai = wb.readUint16(pilotOffset + 55990);
        p.DT_Kill = wb.readUint16(pilotOffset + 55994);
        p.DT_Ex = wb.readUint16(pilotOffset + 55998);
        p.DT_PP = wb.readUint16(pilotOffset + 56000);
        
        p.DT_Kakuto = wb.readUint16(pilotOffset + 56002);
        p.DT_Syageki = wb.readUint16(pilotOffset + 56004);
        p.DT_Bougyo = wb.readUint16(pilotOffset + 56012);
        p.DT_Giryo = wb.readUint16(pilotOffset + 56010);
        p.DT_Kaihi = wb.readUint16(pilotOffset + 56008);
        p.DT_Meicyu = wb.readUint16(pilotOffset + 56006);
        
        // Skill Ginou 1~6
        p.DT_Ginou1 = wb.readUint8(pilotOffset + 56020);
        p.DT_Ginou2 = wb.readUint8(pilotOffset + 56021);
        p.DT_Ginou3 = wb.readUint8(pilotOffset + 56022);
        p.DT_Ginou4 = wb.readUint8(pilotOffset + 56023);
        p.DT_Ginou5 = wb.readUint8(pilotOffset + 56024);
        p.DT_Ginou6 = wb.readUint8(pilotOffset + 56025);
        p.DT_GinouLv1 = wb.readUint8(pilotOffset + 56026);
        p.DT_GinouLv2 = wb.readUint8(pilotOffset + 56027);
        p.DT_GinouLv3 = wb.readUint8(pilotOffset + 56028);
        p.DT_GinouLv4 = wb.readUint8(pilotOffset + 56029);
        p.DT_GinouLv5 = wb.readUint8(pilotOffset + 56030);
        p.DT_GinouLv6 = wb.readUint8(pilotOffset + 56031);
        
        // Terrain
        p.DT_Tchikei1 = wb.readUint8(pilotOffset + 56014);
        p.DT_Tchikei2 = wb.readUint8(pilotOffset + 56015);
        p.DT_Tchikei3 = wb.readUint8(pilotOffset + 56016);
        p.DT_Tchikei4 = wb.readUint8(pilotOffset + 56017);
        
        p.DT_CGFlag = wb.readBits(pilotOffset + 56033, 3, 1) === 1;
        
        // Load pilot's unit mapping (at 42036)
        p.DT_Unit = wb.readUint16(i * 2 + 42036);
        
        this.dataSet.pilotDataSet.push(p);
        pilotOffset += 46;
      }

      // 5. Common Stats
      this.dataSet.Money = wb.readInt32(76660);
      this.dataSet.Jyukurendo = wb.readUint8(77532);
      this.dataSet.Turn = wb.readUint16(76656);
      this.dataSet.Scenario1 = wb.readUint8(76644);
      this.dataSet.Scenario2 = wb.readUint8(76648);
      this.dataSet.StoryNo = wb.readUint8(76652);
      
      this.dataSet.AllBGMOff = wb.readBytesHex(76342, 1) === "04" ? 1 : 0;
      this.dataSet.Clear1 = wb.readUint8(76704);
      this.dataSet.Clear2 = wb.readUint8(76708);
      this.dataSet.Clear3 = wb.readUint8(76712);
      this.dataSet.Mode = wb.readUint8(76632);
      
      // Special 15-stage upgrade check
      this.dataSet.Special15 = 0;
      if (wb.readBits(76728, 1, 1) === 1 && wb.readBits(76732, 1, 1) === 1) {
        this.dataSet.Special15 = 1;
      }

      // 6. Parts & Sozai Counts
      this.dataSet.Parts = [];
      for (let i = 0; i < 43; i++) {
        this.dataSet.Parts.push(wb.readUint8(i * 2 + 76854));
      }
      this.dataSet.Sozai = [];
      for (let i = 0; i < 33; i++) {
        this.dataSet.Sozai.push(wb.readUint8(i * 2 + 76980));
      }
      
    } else if (this.saveType === 'system') {
      this.dataSet.RobotComp = wb.readBytesHex(164436, 1) === "FF" ? 1 : 0;
      this.dataSet.CharacterComp = wb.readBytesHex(164532, 1) === "FF" ? 1 : 0;
      this.dataSet.WordComp = wb.readBytesHex(164628, 1) === "FF" ? 1 : 0;
      this.dataSet.SoundComp = wb.readBytesHex(165012, 1) === "FE" ? 1 : 0;
      this.dataSet.DemoComp = wb.readBytesHex(165044, 1) === "FF" ? 1 : 0;
      this.dataSet.ScenarioComp = wb.readBytesHex(165060, 1) === "FF" ? 1 : 0;
    }
  }

  // Update Binary Buffer from JavaScript DataSet Object
  updateBinary() {
    const wb = this.workBuffer;
    
    if (this.saveType === 'scenario') {
      wb.writeUint8(72708, this.dataSet.title);
      
      // 1. Unit DataSet
      let unitOffset = 0;
      for (let i = 0; i < 99; i++) {
        const u = this.dataSet.unitDataSet[i];
        
        wb.writeBits(Math.floor(i / 8) + 39940, (i % 8) + 1, 1, u.DT_UnitFlag);
        
        let code = u.DT_Code;
        if (u.DT_OG2Flag) code += 1000;
        wb.writeUint16(unitOffset + 42420, code);
        
        for (let j = 0; j < 18; j++) {
          wb.writeUint16(unitOffset + 42422 + j * 2, u.DT_KansouBuki[j]);
        }
        
        wb.writeUint8(unitOffset + 42458, u.DT_Parts1);
        wb.writeUint8(unitOffset + 42459, u.DT_Parts2);
        wb.writeUint8(unitOffset + 42460, u.DT_Parts3);
        wb.writeUint8(unitOffset + 42461, u.DT_Parts4);
        
        wb.writeUint16(unitOffset + 42462, u.DT_Sonzai);
        
        for (let j = 0; j < 32; j++) {
          const bIdx = Math.floor(j / 2);
          const bitPos = (j % 2) * 4 + 1;
          wb.writeBits(unitOffset + 42467 + bIdx, bitPos, 4, u.DT_Buki[j]);
        }
        
        for (let j = 0; j < 32; j++) {
          wb.writeUint8(unitOffset + 42483 + j, u.DT_Tama[j]);
        }
        
        wb.writeUint8(unitOffset + 42521, u.DT_Full);
        wb.writeBits(unitOffset + 42522, 1, 4, u.DT_HP);
        wb.writeBits(unitOffset + 42522, 5, 4, u.DT_EN);
        wb.writeBits(unitOffset + 42523, 1, 4, u.DT_Undou);
        wb.writeBits(unitOffset + 42523, 5, 4, u.DT_Soukou);
        
        // Write 42524 (HP/EN modification flag: 63 if UnitFlag is 1, else 0)
        wb.writeUint8(unitOffset + 42524, u.DT_UnitFlag === 1 ? 63 : 0);
        
        // Write unit pilot mapping (at 39988)
        wb.writeUint16(i * 16 + 39988, u.DT_Pilot1);
        wb.writeUint16(i * 16 + 39992, u.DT_Pilot2);
        wb.writeUint16(i * 16 + 39996, u.DT_Pilot3);
        wb.writeUint16(i * 16 + 40000, u.DT_Pilot4);
        
        unitOffset += 106;
      }

      // 2. Bukiko
      let bukiOffset = 0;
      for (let i = 0; i < 255; i++) {
        const b = this.dataSet.bukikoDataSet[i];
        let code = b.DT_Code;
        if (b.DT_OG2Flag) code += 2000;
        wb.writeUint16(bukiOffset + 64820, code);
        wb.writeUint8(bukiOffset + 64822, b.DT_Tama);
        wb.writeBits(bukiOffset + 64823, 1, 4, b.DT_Kaizou);
        wb.writeBits(bukiOffset + 64823, 5, 1, b.DT_SoubiFlag);
        bukiOffset += 4;
      }

      // 3. Tama
      let tamaOffset = 0;
      for (let i = 0; i < 127; i++) {
        const t = this.dataSet.tamaDataSet[i];
        wb.writeUint8(tamaOffset + 65844, t.Sozai1);
        wb.writeUint8(tamaOffset + 65845, t.Sozai2);
        wb.writeUint8(tamaOffset + 65846, t.Sozai3);
        wb.writeString(tamaOffset + 65848, 21, t.Name);
        wb.writeInt16(tamaOffset + 65872, t.Kougeki);
        wb.data[tamaOffset + 65874] = t.Syatei;
        wb.writeInt16(tamaOffset + 65875, t.Meicyu);
        wb.writeInt16(tamaOffset + 65877, t.Critical);
        wb.data[tamaOffset + 65879] = t.Tama;
        wb.data[tamaOffset + 65880] = t.Kiryoku;
        wb.writeUint8(tamaOffset + 65881, t.Tchikei1);
        wb.writeUint8(tamaOffset + 65882, t.Tchikei2);
        wb.writeUint8(tamaOffset + 65883, t.Tchikei3);
        wb.writeUint8(tamaOffset + 65884, t.Tchikei4);
        wb.writeUint8(tamaOffset + 65885, t.Tokusyu);
        wb.writeBits(tamaOffset + 65886, 1, 1, t.PZokusei);
        wb.writeBits(tamaOffset + 65886, 2, 2, t.Baria);
        wb.writeBits(tamaOffset + 65886, 4, 2, t.TokusyuLv);
        wb.writeBits(tamaOffset + 65886, 6, 1, t.Sonzai);
        
        tamaOffset += 43;
      }

      // 4. Pilot DataSet
      let pilotOffset = 0;
      for (let i = 0; i < 99; i++) {
        const p = this.dataSet.pilotDataSet[i];
        wb.writeBits(Math.floor(i / 8) + 39956, (i % 8) + 1, 1, p.DT_PilotFlag);
        
        let code = p.DT_Code;
        if (p.DT_OG2Flag) code += 1000;
        wb.writeUint16(pilotOffset + 55988, code);
        wb.writeUint16(pilotOffset + 55990, p.DT_Sonzai);
        wb.writeUint16(pilotOffset + 55994, p.DT_Kill);
        wb.writeUint16(pilotOffset + 55998, p.DT_Ex);
        wb.writeUint16(pilotOffset + 56000, p.DT_PP);
        wb.writeUint16(pilotOffset + 56002, p.DT_Kakuto);
        wb.writeUint16(pilotOffset + 56004, p.DT_Syageki);
        wb.writeUint16(pilotOffset + 56012, p.DT_Bougyo);
        wb.writeUint16(pilotOffset + 56010, p.DT_Giryo);
        wb.writeUint16(pilotOffset + 56008, p.DT_Kaihi);
        wb.writeUint16(pilotOffset + 56006, p.DT_Meicyu);
        
        wb.writeUint8(pilotOffset + 56020, p.DT_Ginou1);
        wb.writeUint8(pilotOffset + 56021, p.DT_Ginou2);
        wb.writeUint8(pilotOffset + 56022, p.DT_Ginou3);
        wb.writeUint8(pilotOffset + 56023, p.DT_Ginou4);
        wb.writeUint8(pilotOffset + 56024, p.DT_Ginou5);
        wb.writeUint8(pilotOffset + 56025, p.DT_Ginou6);
        wb.writeUint8(pilotOffset + 56026, p.DT_GinouLv1);
        wb.writeUint8(pilotOffset + 56027, p.DT_GinouLv2);
        wb.writeUint8(pilotOffset + 56028, p.DT_GinouLv3);
        wb.writeUint8(pilotOffset + 56029, p.DT_GinouLv4);
        wb.writeUint8(pilotOffset + 56030, p.DT_GinouLv5);
        wb.writeUint8(pilotOffset + 56031, p.DT_GinouLv6);
        
        wb.writeUint8(pilotOffset + 56014, p.DT_Tchikei1);
        wb.writeUint8(pilotOffset + 56015, p.DT_Tchikei2);
        wb.writeUint8(pilotOffset + 56016, p.DT_Tchikei3);
        wb.writeUint8(pilotOffset + 56017, p.DT_Tchikei4);
        
        wb.writeBits(pilotOffset + 56033, 3, 1, p.DT_CGFlag ? 1 : 0);
        
        // Write pilot unit mapping
        wb.writeUint16(i * 2 + 42036, p.DT_Unit);
        
        pilotOffset += 46;
      }

      // 5. Common Stats
      wb.writeInt32(76660, this.dataSet.Money);
      wb.writeUint8(77532, this.dataSet.Jyukurendo);
      wb.writeUint16(76656, this.dataSet.Turn);
      wb.writeUint8(76644, this.dataSet.Scenario1);
      wb.writeUint8(76648, this.dataSet.Scenario2);
      wb.writeUint8(76652, this.dataSet.StoryNo);
      
      wb.writeBytesHex(76342, this.dataSet.AllBGMOff === 1 ? "04" : "00");
      wb.writeUint8(76704, this.dataSet.Clear1);
      wb.writeUint8(76708, this.dataSet.Clear2);
      wb.writeUint8(76712, this.dataSet.Clear3);
      wb.writeUint8(76632, this.dataSet.Mode);
      
      wb.writeBits(76728, 1, 1, this.dataSet.Special15 === 1 ? 1 : 0);
      wb.writeBits(76732, 1, 1, this.dataSet.Special15 === 1 ? 1 : 0);

      // 6. Parts & Sozai
      for (let i = 0; i < 43; i++) {
        wb.writeUint8(i * 2 + 76854, this.dataSet.Parts[i]);
      }
      for (let i = 0; i < 33; i++) {
        wb.writeUint8(i * 2 + 76980, this.dataSet.Sozai[i]);
      }
      
    } else if (this.saveType === 'system') {
      const compVal = (flag) => flag === 1 ? "FF" : "00";
      
      wb.writeBytesHex(164436, compVal(this.dataSet.RobotComp).repeat(59));
      wb.writeBytesHex(164532, compVal(this.dataSet.CharacterComp).repeat(37));
      
      wb.writeBytesHex(164628, compVal(this.dataSet.WordComp) === "FF" ? "FFFFFFFF3F" : "0000000000");
      wb.writeBytesHex(164753, compVal(this.dataSet.WordComp) === "FF" ? "FFFFFFFFFFFFFFFFFFFFFFFF" : "000000000000000000000000");
      
      wb.writeBytesHex(165012, compVal(this.dataSet.SoundComp) === "FF" ? "FEFFFFF8FFFFFFFFFFFFFFFFFFFBBBFF" : "00000000000000000000000000000000");
      wb.writeBytesHex(165044, compVal(this.dataSet.DemoComp) === "FF" ? "FFFF3F00000080" : "00000000000000");
      
      wb.writeBytesHex(165060, compVal(this.dataSet.ScenarioComp) === "FF" ? "FFFFFFFFFFFFFFFFFFFF" : "00000000000000000000");
      wb.writeBytesHex(165092, compVal(this.dataSet.ScenarioComp) === "FF" ? "FFFFFFFFFFFFFFFFFFFFFFFFFFFF" : "0000000000000000000000000000");
      wb.writeBytesHex(165124, compVal(this.dataSet.ScenarioComp) === "FF" ? "FFFF" : "0000");
    }
  }

  // Calculate Checksum & Re-apply XOR Mask
  buildFinalSave() {
    // 1. Sync JavaScript Data Model to unmasked workBuffer
    this.updateBinary();

    // 2. Encrypt workBuffer (XOR mask)
    this.applyXorMask();

    // 3. Compute Checksum on the masked workBuffer
    const wb = this.workBuffer;
    let checksumValue = this.config.defaultCheckSum;
    
    for (let offset = this.config.checkSumStart; offset <= this.config.checkSumEnd; offset += 4) {
      // Read 4 bytes as Big Endian representation (Order=0 in C# ReadBytesString)
      let val = 0;
      for (let i = 0; i < 4; i++) {
        // C# ReadBytesString order=0 accumulates by prepending
        // Meaning byte at offset is least significant, byte at offset+3 is most significant (Little Endian conversion)
        val |= wb.data[offset + i] << (i * 8);
      }
      checksumValue = (checksumValue + val) & 0xFFFFFFFF;
    }

    // Write computed checksum to file (Little Endian, unmasked)
    wb.writeUint32(this.config.checkSum, checksumValue);

    // 4. Copy back to original file structure
    let finalBuffer;
    if (this.formatInfo.format === 'bin_full') {
      finalBuffer = new Uint8Array(wb.buffer);
    } else if (this.formatInfo.format === 'bin_raw') {
      // Only extract actual raw save size
      finalBuffer = wb.data.subarray(this.config.workDataStartAddress, this.config.workDataStartAddress + this.config.dataSize);
    } else {
      // Re-insert into original container file
      finalBuffer = new Uint8Array(this.originalBuffer.length);
      finalBuffer.set(this.originalBuffer);
      const sub = wb.data.subarray(this.config.workDataStartAddress, this.config.workDataStartAddress + this.config.dataSize);
      finalBuffer.set(sub, this.formatInfo.startOffset);
    }

    return finalBuffer;
  }
}

// ==========================================
// 5. Global State & UI Controller
// ==========================================
let currentEditor = null;
let currentFile = null;

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const loaderScreen = document.getElementById('loader-screen');
const editorScreen = document.getElementById('editor-screen');
const loadedFileInfo = document.getElementById('loaded-file-info');
const btnSaveFile = document.getElementById('btn-save-file');
const btnCloseFile = document.getElementById('btn-close-file');

// UI Initializers & Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  setupFileLoader();
  setupNavigationTabs();
  setupFormControls();
});

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon"><i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i></span>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  
  // Animate In
  setTimeout(() => toast.classList.add('show'), 50);
  
  // Auto Remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// File Loading Logic
function setupFileLoader() {
  dropZone.addEventListener('click', () => fileInput.click());
  
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  btnCloseFile.addEventListener('click', () => {
    // Reset editor
    currentEditor = null;
    currentFile = null;
    
    loadedFileInfo.style.display = 'none';
    btnCloseFile.style.display = 'none';
    btnSaveFile.classList.add('btn-disabled');
    btnSaveFile.disabled = true;
    
    editorScreen.classList.remove('active');
    loaderScreen.style.display = 'flex';
    fileInput.value = '';
    
    showToast("파일이 닫혔습니다.", "success");
  });

  btnSaveFile.addEventListener('click', () => {
    if (!currentEditor) return;
    try {
      const finalBytes = currentEditor.buildFinalSave();
      const blob = new Blob([finalBytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = currentFile.name;
      a.click();
      
      URL.revokeObjectURL(url);
      showToast("세이브 파일이 성공적으로 보존 및 다운로드되었습니다!", "success");
    } catch (e) {
      console.error(e);
      showToast("세이브 파일 보존 중 에러가 발생했습니다.", "error");
    }
  });
}

function handleFile(file) {
  currentFile = file;
  const reader = new FileReader();
  reader.onload = function(e) {
    const buffer = e.target.result;
    
    // Auto-detect Save File Type ('scenario' or 'system')
    // Attempt Scenario first, then System
    let formatInfo = detectSaveFormat(buffer, 'scenario');
    let saveType = 'scenario';
    
    if (!formatInfo) {
      formatInfo = detectSaveFormat(buffer, 'system');
      saveType = 'system';
    }
    
    if (!formatInfo) {
      showToast("올바른 SRW OG's 세이브 파일을 감지할 수 없습니다.", "error");
      return;
    }

    try {
      currentEditor = new SaveEditor(buffer, saveType, formatInfo);
      
      // Update UI Header
      const typeStr = saveType === 'scenario' ? '시나리오 데이터' : '시스템 데이터';
      loadedFileInfo.textContent = `[${typeStr}] ${file.name} (${Math.round(file.size / 1024)} KB)`;
      loadedFileInfo.style.display = 'inline';
      btnCloseFile.style.display = 'inline-flex';
      
      btnSaveFile.classList.remove('btn-disabled');
      btnSaveFile.disabled = false;
      
      // Transition screen
      loaderScreen.style.display = 'none';
      editorScreen.classList.add('active');
      
      // Reset view to Main tab
      document.querySelector('.nav-tab[data-tab="main"]').click();
      
      // Initialize forms
      initEditorUI();
      
      showToast(`세이브 파일 로드 성공: ${typeStr}`, "success");
    } catch (err) {
      console.error(err);
      showToast("세이브 데이터 해석 중 오류가 발생했습니다.", "error");
    }
  };
  
  reader.readAsArrayBuffer(file);
}

// Navigation Tabs
function setupNavigationTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (!currentEditor) return;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const tabId = tab.dataset.tab;
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`panel-${tabId}`).classList.add('active');
      
      // Reload Tab Content
      renderTab(tabId);
    });
  });
}

// ==========================================
// 6. UI Rendering & Bindings
// ==========================================
function initEditorUI() {
  const ds = currentEditor.dataSet;
  const isScenario = currentEditor.saveType === 'scenario';

  // Toggle Tab Visibility
  const scenarioTabs = document.querySelectorAll('.nav-tab:not([data-tab="main"])');
  scenarioTabs.forEach(t => {
    t.style.display = isScenario ? 'flex' : 'none';
  });

  if (isScenario) {
    document.getElementById('main-scenario-fields').style.display = 'grid';
    document.getElementById('main-system-fields').style.display = 'none';
    document.getElementById('items-scenario-container').style.display = 'flex';
    document.getElementById('items-system-placeholder').style.display = 'none';
    
    // Fill Main Tab Options
    fillSelectOptions('main-mode', GAME_LISTS.P5_1_Mode);
    fillSelectOptions('main-scenario1', GAME_LISTS.P5_1_Scenario1OG1);
    fillSelectOptions('main-scenario2', GAME_LISTS.P5_1_Scenario1OG2);
    fillSelectOptions('main-scenario3', GAME_LISTS.P5_1_Scenario1OG25);
    
    // Bind Main Tab Values
    document.getElementById('main-money').value = ds.Money;
    document.getElementById('main-jyukurendo').value = ds.Jyukurendo;
    document.getElementById('main-turn').value = ds.Turn;
    document.getElementById('main-storyno').value = ds.StoryNo;
    document.getElementById('main-clear1').value = ds.Clear1;
    document.getElementById('main-clear2').value = ds.Clear2;
    document.getElementById('main-clear3').value = ds.Clear3;
    document.getElementById('main-special15').checked = ds.Special15 === 1;
    document.getElementById('main-bgmoff').checked = ds.AllBGMOff === 1;
    
    // Bind dropdowns index based
    document.getElementById('main-mode').value = ds.Mode;
    
    // Find index of Scenario Code
    // C# 툴에 매핑된 코드로 매칭
    const scCodeOG1 = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,48,49,50,51];
    const scCodeOG2 = [0,104,105,106,107,108,1,2,3,4,5,6,7,8,103,101,9,76,10,11,12,13,40,41,42,43,14,15,16,17,18,19,77,20,21,22,23,44,45,46,47,24,55,25,26,27,56,28,29,30,57,79,78,31,32,33,48,49,50,34,35,36,37,58,38,39,102];
    const scCodeOG25 = [1,2,3,4,5,6,7,8,9,10,11,12];
    
    document.getElementById('main-scenario1').value = scCodeOG1.indexOf(ds.Scenario1);
    document.getElementById('main-scenario2').value = scCodeOG2.indexOf(ds.Scenario2);
    // StoryNo is used to track OG2.5 scenario (from 1 to 12)
    document.getElementById('main-scenario3').value = scCodeOG25.indexOf(ds.StoryNo);
    
  } else {
    // System Save UI
    document.getElementById('main-scenario-fields').style.display = 'none';
    document.getElementById('main-system-fields').style.display = 'grid';
    document.getElementById('items-scenario-container').style.display = 'none';
    document.getElementById('items-system-placeholder').style.display = 'block';

    document.getElementById('sys-robotcomp').checked = ds.RobotComp === 1;
    document.getElementById('sys-charcomp').checked = ds.CharacterComp === 1;
    document.getElementById('sys-wordcomp').checked = ds.WordComp === 1;
    document.getElementById('sys-soundcomp').checked = ds.SoundComp === 1;
    document.getElementById('sys-democomp').checked = ds.DemoComp === 1;
    document.getElementById('sys-scenariocomp').checked = ds.ScenarioComp === 1;
  }
}

// Fill dropdown list
function fillSelectOptions(elementId, itemsList, placeholder = null) {
  const select = document.getElementById(elementId);
  select.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = "65535";
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  itemsList.forEach((item, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `${idx.toString().padStart(3, '0')}: ${item}`;
    select.appendChild(opt);
  });
}

function renderTab(tabId) {
  if (tabId === 'units') {
    renderUnitsList();
  } else if (tabId === 'pilots') {
    renderPilotsList();
  } else if (tabId === 'weapons') {
    renderWeaponsList();
  } else if (tabId === 'tama') {
    renderTamaList();
  } else if (tabId === 'items') {
    renderItemsTab();
  }
}

// ------------------------------------------
// Units Tab Render
// ------------------------------------------
let selectedUnitIdx = -1;
function renderUnitsList() {
  const container = document.getElementById('unit-list-container');
  const searchKey = document.getElementById('unit-search').value.toLowerCase();
  container.innerHTML = '';
  
  const ds = currentEditor.dataSet;
  ds.unitDataSet.forEach((u, idx) => {
    const unitName = GAME_LISTS.P1_UnitNameList[u.DT_Code] || `Unknown (${u.DT_Code})`;
    // Check if matches search
    if (searchKey && !unitName.toLowerCase().includes(searchKey) && !idx.toString().includes(searchKey)) {
      return;
    }
    
    const pilotName = u.DT_Pilot1 !== 65535 ? (GAME_LISTS.P3_PilotNameList[ds.pilotDataSet[u.DT_Pilot1]?.DT_Code] || "무인") : "무인";
    
    const div = document.createElement('div');
    div.className = `list-item ${selectedUnitIdx === idx ? 'selected' : ''}`;
    div.innerHTML = `
      <div class="item-index">#${idx.toString().padStart(2, '0')}</div>
      <div class="item-details">
        <div class="item-title">${unitName}</div>
        <div class="item-subtitle"><i class="fa-solid fa-user-astronaut"></i> ${pilotName}</div>
      </div>
    `;
    div.addEventListener('click', () => selectUnit(idx));
    container.appendChild(div);
  });
}

function selectUnit(idx) {
  selectedUnitIdx = idx;
  document.querySelectorAll('#unit-list-container .list-item').forEach((item, index) => {
    item.classList.toggle('selected', index === idx);
  });
  
  // Show Detail Form
  document.getElementById('unit-empty-state').style.display = 'none';
  document.getElementById('unit-detail-header').style.display = 'flex';
  document.getElementById('unit-detail-body').style.display = 'flex';
  
  const ds = currentEditor.dataSet;
  const u = ds.unitDataSet[idx];
  
  const unitName = GAME_LISTS.P1_UnitNameList[u.DT_Code] || `Unknown`;
  document.getElementById('unit-detail-title').textContent = unitName;
  document.getElementById('unit-detail-idx').textContent = `SLOT #${idx.toString().padStart(2, '0')}`;
  
  // Fill unit code options (if not filled)
  const codeSelect = document.getElementById('unit-code-select');
  if (codeSelect.options.length === 0) {
    fillSelectOptions('unit-code-select', GAME_LISTS.P1_UnitNameList);
  }
  codeSelect.value = u.DT_Code;
  
  // Existence
  document.getElementById('unit-sonzai-check').checked = u.DT_Sonzai === 0; // C# 툴: 0이 존재, 그 외엔 비활성
  document.getElementById('unit-og2-check').checked = u.DT_OG2Flag;
  
  // Full upgrade bonus
  const bonusSelect = document.getElementById('unit-full-bonus');
  if (bonusSelect.options.length === 0) {
    fillSelectOptions('unit-full-bonus', GAME_LISTS.P1_1_Full);
  }
  bonusSelect.value = u.DT_Full;
  
  // Upgrades
  bindUpgradeRange('unit-hp', u.DT_HP);
  bindUpgradeRange('unit-en', u.DT_EN);
  bindUpgradeRange('unit-undou', u.DT_Undou);
  bindUpgradeRange('unit-soukou', u.DT_Soukou);

  // Parts dropdowns
  const parts = ['parts-1', 'parts-2', 'parts-3', 'parts-4'];
  parts.forEach((pId, pIdx) => {
    const select = document.getElementById(`unit-${pId}`);
    if (select.options.length === 0) {
      fillSelectOptions(`unit-${pId}`, GAME_LISTS.P4_2_PartsList, "장착 안 함");
    }
    select.value = u[`DT_Parts${pIdx+1}`] === 0 ? "65535" : u[`DT_Parts${pIdx+1}`] - 1; // 0이 미장착
  });

  // Pilots dropdowns
  const pilots = ['pilot-1', 'pilot-2', 'pilot-3', 'pilot-4'];
  pilots.forEach((pId, pIdx) => {
    const select = document.getElementById(`unit-${pId}`);
    if (select.options.length === 0) {
      // Build pilot mapping names based on PilotDataSet
      const pilotMappingNames = ds.pilotDataSet.map((p, pSlot) => {
        const name = GAME_LISTS.P3_PilotNameList[p.DT_Code] || `Unknown (${p.DT_Code})`;
        return `[SLOT #${pSlot.toString().padStart(2, '0')}] ${name}`;
      });
      fillSelectOptions(`unit-${pId}`, pilotMappingNames, "무인 (Empty)");
    }
    select.value = u[`DT_Pilot${pIdx+1}`];
  });

  // Dynamic Weapon Upgrades Grid
  const weaponGrid = document.getElementById('unit-weapons-container');
  weaponGrid.innerHTML = '';
  
  // We need to render the weapons that are active on this unit.
  // There are up to 32 slots.
  for (let j = 0; j < 32; j++) {
    const wLevel = u.DT_Buki[j];
    const tId = u.DT_Tama[j]; // Tama Index (0-127)
    
    const wDiv = document.createElement('div');
    wDiv.className = 'slider-group';
    wDiv.style.gridColumn = 'span 2';
    wDiv.innerHTML = `
      <div class="slider-header">
        <span class="slider-label">무기 슬롯 #${(j+1).toString().padStart(2, '0')} 개조</span>
        <span class="slider-value" id="val-unit-wp-${j}">${wLevel}</span>
      </div>
      <div class="slider-container" style="margin-bottom: 8px;">
        <input type="range" id="unit-wp-${j}-range" min="0" max="15" value="${wLevel}">
      </div>
      <div class="form-group">
        <label style="font-size: 0.75rem;">장착 특수탄</label>
        <select id="unit-wp-${j}-tama" class="form-control" style="padding: 6px 10px; font-size: 0.8rem;"></select>
      </div>
    `;
    weaponGrid.appendChild(wDiv);
    
    // Fill Tama dropdown
    const tSelect = document.getElementById(`unit-wp-${j}-tama`);
    const tamaNames = ds.tamaDataSet.map((t, tIdx) => {
      const tName = t.Name !== "" ? t.Name : "이름 없음";
      return `[#${tIdx.toString().padStart(3, '0')}] ${tName}`;
    });
    fillSelectOptions(`unit-wp-${j}-tama`, tamaNames, "장전 안 함");
    tSelect.value = tId === 255 ? "65535" : tId;

    // Range bindings
    const range = document.getElementById(`unit-wp-${j}-range`);
    const valText = document.getElementById(`val-unit-wp-${j}`);
    range.addEventListener('input', (e) => {
      const v = parseInt(e.target.value);
      valText.textContent = v;
      u.DT_Buki[j] = v;
    });
    
    tSelect.addEventListener('change', (e) => {
      const v = parseInt(e.target.value);
      u.DT_Tama[j] = v === 65535 ? 255 : v;
    });
  }
}

function bindUpgradeRange(id, val) {
  const range = document.getElementById(`${id}-range`);
  const valText = document.getElementById(`val-${id}`);
  range.value = val;
  valText.textContent = val;
}

// ------------------------------------------
// Pilots Tab Render
// ------------------------------------------
let selectedPilotIdx = -1;
function renderPilotsList() {
  const container = document.getElementById('pilot-list-container');
  const searchKey = document.getElementById('pilot-search').value.toLowerCase();
  container.innerHTML = '';
  
  const ds = currentEditor.dataSet;
  ds.pilotDataSet.forEach((p, idx) => {
    const pilotName = GAME_LISTS.P3_PilotNameList[p.DT_Code] || `Unknown (${p.DT_Code})`;
    if (searchKey && !pilotName.toLowerCase().includes(searchKey) && !idx.toString().includes(searchKey)) {
      return;
    }
    
    const div = document.createElement('div');
    div.className = `list-item ${selectedPilotIdx === idx ? 'selected' : ''}`;
    div.innerHTML = `
      <div class="item-index">#${idx.toString().padStart(2, '0')}</div>
      <div class="item-details">
        <div class="item-title">${pilotName}</div>
        <div class="item-subtitle"><i class="fa-solid fa-star"></i> 격추수: ${p.DT_Kill}</div>
      </div>
    `;
    div.addEventListener('click', () => selectPilot(idx));
    container.appendChild(div);
  });
}

function selectPilot(idx) {
  selectedPilotIdx = idx;
  document.querySelectorAll('#pilot-list-container .list-item').forEach((item, index) => {
    item.classList.toggle('selected', index === idx);
  });
  
  document.getElementById('pilot-empty-state').style.display = 'none';
  document.getElementById('pilot-detail-header').style.display = 'flex';
  document.getElementById('pilot-detail-body').style.display = 'flex';
  
  const ds = currentEditor.dataSet;
  const p = ds.pilotDataSet[idx];
  
  const pilotName = GAME_LISTS.P3_PilotNameList[p.DT_Code] || `Unknown`;
  document.getElementById('pilot-detail-title').textContent = pilotName;
  document.getElementById('pilot-detail-idx').textContent = `SLOT #${idx.toString().padStart(2, '0')}`;
  
  // Code Select
  const codeSelect = document.getElementById('pilot-code-select');
  if (codeSelect.options.length === 0) {
    fillSelectOptions('pilot-code-select', GAME_LISTS.P3_PilotNameList);
  }
  codeSelect.value = p.DT_Code;
  
  // Existence
  document.getElementById('pilot-sonzai-check').checked = p.DT_Sonzai === 0;
  document.getElementById('pilot-og2-check').checked = p.DT_OG2Flag;
  
  document.getElementById('pilot-unit-id').value = p.DT_Unit;
  document.getElementById('pilot-cgflag-check').checked = p.DT_CGFlag;
  
  // Growth
  document.getElementById('pilot-pp').value = p.DT_PP;
  document.getElementById('pilot-kills').value = p.DT_Kill;
  document.getElementById('pilot-ex').value = p.DT_Ex;
  
  // Stats
  document.getElementById('pilot-kakuto').value = p.DT_Kakuto;
  document.getElementById('pilot-syageki').value = p.DT_Syageki;
  document.getElementById('pilot-bougyo').value = p.DT_Bougyo;
  document.getElementById('pilot-giryo').value = p.DT_Giryo;
  document.getElementById('pilot-kaihi').value = p.DT_Kaihi;
  document.getElementById('pilot-meicyu').value = p.DT_Meicyu;

  // Terrain
  document.getElementById('pilot-adp-air').value = p.DT_Tchikei1;
  document.getElementById('pilot-adp-ground').value = p.DT_Tchikei2;
  document.getElementById('pilot-adp-water').value = p.DT_Tchikei3;
  document.getElementById('pilot-adp-space').value = p.DT_Tchikei4;

  // Skills
  const skillGrid = document.getElementById('pilot-skills-container');
  skillGrid.innerHTML = '';
  
  for (let j = 1; j <= 6; j++) {
    const sId = p[`DT_Ginou${j}`];
    const sLv = p[`DT_GinouLv${j}`];
    
    const sDiv = document.createElement('div');
    sDiv.className = 'form-group';
    sDiv.innerHTML = `
      <label>특수능력 ${j}</label>
      <select id="pilot-skill-${j}" class="form-control" style="margin-bottom: 6px;"></select>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 0.75rem; color: var(--text-secondary);">능력 레벨:</span>
        <input type="number" id="pilot-skill-lv-${j}" class="form-control" style="padding: 4px 8px; width: 60px; height: 26px;" min="0" max="9" value="${sLv}">
      </div>
    `;
    skillGrid.appendChild(sDiv);
    
    // Fill skills select
    const sSelect = document.getElementById(`pilot-skill-${j}`);
    if (sSelect.options.length === 0) {
      fillSelectOptions(`pilot-skill-${j}`, GAME_LISTS.P3_3_Ginou1);
    }
    sSelect.value = sId;

    sSelect.addEventListener('change', (e) => {
      p[`DT_Ginou${j}`] = parseInt(e.target.value);
    });
    
    const lvInput = document.getElementById(`pilot-skill-lv-${j}`);
    lvInput.addEventListener('input', (e) => {
      p[`DT_GinouLv${j}`] = parseInt(e.target.value) || 0;
    });
  }
}

// ------------------------------------------
// Weapons Tab Render
// ------------------------------------------
let selectedWeaponIdx = -1;
function renderWeaponsList() {
  const container = document.getElementById('weapon-list-container');
  const searchKey = document.getElementById('weapon-search').value.toLowerCase();
  container.innerHTML = '';
  
  const ds = currentEditor.dataSet;
  ds.bukikoDataSet.forEach((b, idx) => {
    // Map code to list (based on OG2 flag)
    const listSource = b.DT_OG2Flag ? GAME_LISTS.P2_1_KansoBukiNameListOG2 : GAME_LISTS.P2_1_KansoBukiNameListOG1;
    const bukiName = listSource[b.DT_Code] || `Unknown (${b.DT_Code})`;
    
    if (searchKey && !bukiName.toLowerCase().includes(searchKey) && !idx.toString().includes(searchKey)) {
      return;
    }
    
    const div = document.createElement('div');
    div.className = `list-item ${selectedWeaponIdx === idx ? 'selected' : ''}`;
    div.innerHTML = `
      <div class="item-index">#${idx.toString().padStart(3, '0')}</div>
      <div class="item-details">
        <div class="item-title">${bukiName}</div>
        <div class="item-subtitle">개조: ${b.DT_Kaizou}단 | 장착: ${b.DT_SoubiFlag === 1 ? '장착 중' : '보관 중'}</div>
      </div>
    `;
    div.addEventListener('click', () => selectWeapon(idx));
    container.appendChild(div);
  });
}

function selectWeapon(idx) {
  selectedWeaponIdx = idx;
  document.querySelectorAll('#weapon-list-container .list-item').forEach((item, index) => {
    item.classList.toggle('selected', index === idx);
  });
  
  document.getElementById('weapon-empty-state').style.display = 'none';
  document.getElementById('weapon-detail-header').style.display = 'flex';
  document.getElementById('weapon-detail-body').style.display = 'flex';
  
  const ds = currentEditor.dataSet;
  const b = ds.bukikoDataSet[idx];
  
  const listSource = b.DT_OG2Flag ? GAME_LISTS.P2_1_KansoBukiNameListOG2 : GAME_LISTS.P2_1_KansoBukiNameListOG1;
  const bukiName = listSource[b.DT_Code] || `Unknown`;
  
  document.getElementById('weapon-detail-title').textContent = bukiName;
  document.getElementById('weapon-detail-idx').textContent = `SLOT #${idx.toString().padStart(3, '0')}`;
  
  // Fill Options based on OG2 flag
  const codeSelect = document.getElementById('weapon-code-select');
  fillSelectOptions('weapon-code-select', listSource);
  codeSelect.value = b.DT_Code;
  
  document.getElementById('weapon-og2-check').checked = b.DT_OG2Flag;
  document.getElementById('weapon-soubi-check').checked = b.DT_SoubiFlag === 1;
  document.getElementById('weapon-tama-id').value = b.DT_Tama;
  
  bindUpgradeRange('weapon-kaizou', b.DT_Kaizou);
}

// ------------------------------------------
// Tama (특수탄) Tab Render
// ------------------------------------------
let selectedTamaIdx = -1;
function renderTamaList() {
  const container = document.getElementById('tama-list-container');
  const searchKey = document.getElementById('tama-search').value.toLowerCase();
  container.innerHTML = '';
  
  const ds = currentEditor.dataSet;
  ds.tamaDataSet.forEach((t, idx) => {
    const tName = t.Name !== "" ? t.Name : "이름 없음";
    if (searchKey && !tName.toLowerCase().includes(searchKey) && !idx.toString().includes(searchKey)) {
      return;
    }
    
    const div = document.createElement('div');
    div.className = `list-item ${selectedTamaIdx === idx ? 'selected' : ''}`;
    div.innerHTML = `
      <div class="item-index">#${idx.toString().padStart(3, '0')}</div>
      <div class="item-details">
        <div class="item-title">${tName}</div>
        <div class="item-subtitle">공격력 +${t.Kougeki} | 탄수: ${t.Tama}</div>
      </div>
    `;
    div.addEventListener('click', () => selectTama(idx));
    container.appendChild(div);
  });
}

function selectTama(idx) {
  selectedTamaIdx = idx;
  document.querySelectorAll('#tama-list-container .list-item').forEach((item, index) => {
    item.classList.toggle('selected', index === idx);
  });
  
  document.getElementById('tama-empty-state').style.display = 'none';
  document.getElementById('tama-detail-header').style.display = 'flex';
  document.getElementById('tama-detail-body').style.display = 'flex';
  
  const ds = currentEditor.dataSet;
  const t = ds.tamaDataSet[idx];
  
  const tName = t.Name !== "" ? t.Name : "이름 없음";
  document.getElementById('tama-detail-title').textContent = tName;
  document.getElementById('tama-detail-idx').textContent = `SLOT #${idx.toString().padStart(3, '0')}`;
  
  document.getElementById('tama-name').value = t.Name;
  
  // Sozai options
  const sozaiDropdowns = ['tama-sozai1', 'tama-sozai2', 'tama-sozai3'];
  sozaiDropdowns.forEach(sId => {
    const select = document.getElementById(sId);
    if (select.options.length === 0) {
      fillSelectOptions(sId, GAME_LISTS.P2_3_SozaiList, "없음");
    }
  });
  document.getElementById('tama-sozai1').value = t.Sozai1 === 255 ? "65535" : t.Sozai1;
  document.getElementById('tama-sozai2').value = t.Sozai2 === 255 ? "65535" : t.Sozai2;
  document.getElementById('tama-sozai3').value = t.Sozai3 === 255 ? "65535" : t.Sozai3;

  document.getElementById('tama-sonzai-check').checked = t.Sonzai === 1;
  
  // Spec values
  document.getElementById('tama-kougeki').value = t.Kougeki;
  document.getElementById('tama-syatei').value = t.Syatei;
  document.getElementById('tama-meicyu').value = t.Meicyu;
  document.getElementById('tama-critical').value = t.Critical;
  document.getElementById('tama-count').value = t.Tama;
  document.getElementById('tama-kiryoku').value = t.Kiryoku;

  // Terrain adp
  document.getElementById('tama-adp-air').value = t.Tchikei1;
  document.getElementById('tama-adp-ground').value = t.Tchikei2;
  document.getElementById('tama-adp-water').value = t.Tchikei3;
  document.getElementById('tama-adp-space').value = t.Tchikei4;

  // Tokusyu & Baria
  const tSelect = document.getElementById('tama-tokusyu');
  if (tSelect.options.length === 0) {
    fillSelectOptions('tama-tokusyu', GAME_LISTS.P2_2_2_Tokusyu);
  }
  tSelect.value = t.Tokusyu;
  document.getElementById('tama-tokusyulv').value = t.TokusyuLv;

  const bSelect = document.getElementById('tama-baria');
  if (bSelect.options.length === 0) {
    fillSelectOptions('tama-baria', GAME_LISTS.P2_2_2_Baria);
  }
  bSelect.value = t.Baria;

  document.getElementById('tama-pzokusei-check').checked = t.PZokusei === 1;
}

// ------------------------------------------
// Items (Parts & Sozai) Tab Render
// ------------------------------------------
function renderItemsTab() {
  if (currentEditor.saveType !== 'scenario') return;
  const ds = currentEditor.dataSet;
  
  // Parts Grid
  const partsContainer = document.getElementById('parts-grid-container');
  partsContainer.innerHTML = '';
  GAME_LISTS.P4_2_PartsList.forEach((name, idx) => {
    const count = ds.Parts[idx] || 0;
    const card = document.createElement('div');
    card.className = 'item-counter-card';
    card.innerHTML = `
      <div class="item-counter-info">
        <span class="item-counter-title">${name}</span>
        <span class="item-counter-index">ID #${idx.toString().padStart(2, '0')}</span>
      </div>
      <div class="item-counter-controls">
        <button class="counter-btn" onclick="adjustItemCount('Parts', ${idx}, -1)">-</button>
        <input type="number" class="counter-input" id="item-parts-${idx}" min="0" max="99" value="${count}">
        <button class="counter-btn" onclick="adjustItemCount('Parts', ${idx}, 1)">+</button>
      </div>
    `;
    partsContainer.appendChild(card);
    
    // Bind direct input
    const input = document.getElementById(`item-parts-${idx}`);
    input.addEventListener('change', (e) => {
      const v = Math.min(99, Math.max(0, parseInt(e.target.value) || 0));
      input.value = v;
      ds.Parts[idx] = v;
    });
  });

  // Sozai Grid
  const sozaiContainer = document.getElementById('sozai-grid-container');
  sozaiContainer.innerHTML = '';
  GAME_LISTS.P2_3_SozaiList.forEach((name, idx) => {
    const count = ds.Sozai[idx] || 0;
    const card = document.createElement('div');
    card.className = 'item-counter-card';
    card.innerHTML = `
      <div class="item-counter-info">
        <span class="item-counter-title">${name}</span>
        <span class="item-counter-index">ID #${idx.toString().padStart(2, '0')}</span>
      </div>
      <div class="item-counter-controls">
        <button class="counter-btn" onclick="adjustItemCount('Sozai', ${idx}, -1)">-</button>
        <input type="number" class="counter-input" id="item-sozai-${idx}" min="0" max="99" value="${count}">
        <button class="counter-btn" onclick="adjustItemCount('Sozai', ${idx}, 1)">+</button>
      </div>
    `;
    sozaiContainer.appendChild(card);
    
    const input = document.getElementById(`item-sozai-${idx}`);
    input.addEventListener('change', (e) => {
      const v = Math.min(99, Math.max(0, parseInt(e.target.value) || 0));
      input.value = v;
      ds.Sozai[idx] = v;
    });
  });
}

// Global scope counter helper
window.adjustItemCount = function(arrayName, index, offset) {
  if (!currentEditor) return;
  const ds = currentEditor.dataSet;
  const currentVal = ds[arrayName][index] || 0;
  const newVal = Math.min(99, Math.max(0, currentVal + offset));
  
  ds[arrayName][index] = newVal;
  
  const idStr = `item-${arrayName.toLowerCase()}-${index}`;
  const input = document.getElementById(idStr);
  if (input) {
    input.value = newVal;
  }
};

// ==========================================
// 7. Form Controls Event Listeners (Syncing to model)
// ==========================================
function setupFormControls() {
  // --- Search Input Listeners ---
  document.getElementById('unit-search').addEventListener('input', renderUnitsList);
  document.getElementById('pilot-search').addEventListener('input', renderPilotsList);
  document.getElementById('weapon-search').addEventListener('input', renderWeaponsList);
  document.getElementById('tama-search').addEventListener('input', renderTamaList);

  // --- Main Tab Listeners ---
  const bindMainInput = (elId, modelKey, isNum = true) => {
    document.getElementById(elId).addEventListener('input', (e) => {
      if (!currentEditor) return;
      let val = isNum ? (parseInt(e.target.value) || 0) : e.target.value;
      
      // Limit check
      if (elId === 'main-money') val = Math.min(99999999, Math.max(0, val));
      if (elId === 'main-jyukurendo') val = Math.min(99, Math.max(0, val));
      if (elId === 'main-turn') val = Math.min(9999, Math.max(0, val));
      if (elId === 'main-storyno') val = Math.min(255, Math.max(0, val));
      if (e.target.type === 'number') e.target.value = val;
      
      currentEditor.dataSet[modelKey] = val;
    });
  };
  
  bindMainInput('main-money', 'Money');
  bindMainInput('main-jyukurendo', 'Jyukurendo');
  bindMainInput('main-turn', 'Turn');
  bindMainInput('main-storyno', 'StoryNo');
  bindMainInput('main-clear1', 'Clear1');
  bindMainInput('main-clear2', 'Clear2');
  bindMainInput('main-clear3', 'Clear3');

  document.getElementById('main-mode').addEventListener('change', (e) => {
    if (!currentEditor) return;
    currentEditor.dataSet.Mode = parseInt(e.target.value);
  });

  const scCodeOG1 = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,48,49,50,51];
  const scCodeOG2 = [0,104,105,106,107,108,1,2,3,4,5,6,7,8,103,101,9,76,10,11,12,13,40,41,42,43,14,15,16,17,18,19,77,20,21,22,23,44,45,46,47,24,55,25,26,27,56,28,29,30,57,79,78,31,32,33,48,49,50,34,35,36,37,58,38,39,102];
  const scCodeOG25 = [1,2,3,4,5,6,7,8,9,10,11,12];

  document.getElementById('main-scenario1').addEventListener('change', (e) => {
    if (!currentEditor) return;
    currentEditor.dataSet.Scenario1 = scCodeOG1[parseInt(e.target.value)] || 0;
  });
  document.getElementById('main-scenario2').addEventListener('change', (e) => {
    if (!currentEditor) return;
    currentEditor.dataSet.Scenario2 = scCodeOG2[parseInt(e.target.value)] || 0;
  });
  document.getElementById('main-scenario3').addEventListener('change', (e) => {
    if (!currentEditor) return;
    // OG2.5 uses StoryNo for scenario selection in the 윈폼 tool
    const val = scCodeOG25[parseInt(e.target.value)] || 1;
    currentEditor.dataSet.StoryNo = val;
  });

  document.getElementById('main-special15').addEventListener('change', (e) => {
    if (!currentEditor) return;
    currentEditor.dataSet.Special15 = e.target.checked ? 1 : 0;
  });
  
  document.getElementById('main-bgmoff').addEventListener('change', (e) => {
    if (!currentEditor) return;
    currentEditor.dataSet.AllBGMOff = e.target.checked ? 1 : 0;
  });

  // --- System SAVE Options ---
  const bindSystemToggle = (elId, modelKey) => {
    document.getElementById(elId).addEventListener('change', (e) => {
      if (!currentEditor) return;
      currentEditor.dataSet[modelKey] = e.target.checked ? 1 : 0;
    });
  };
  bindSystemToggle('sys-robotcomp', 'RobotComp');
  bindSystemToggle('sys-charcomp', 'CharacterComp');
  bindSystemToggle('sys-wordcomp', 'WordComp');
  bindSystemToggle('sys-soundcomp', 'SoundComp');
  bindSystemToggle('sys-democomp', 'DemoComp');
  bindSystemToggle('sys-scenariocomp', 'ScenarioComp');

  // --- Unit Tab Fields ---
  document.getElementById('unit-code-select').addEventListener('change', (e) => {
    if (selectedUnitIdx === -1) return;
    const u = currentEditor.dataSet.unitDataSet[selectedUnitIdx];
    u.DT_Code = parseInt(e.target.value);
    
    // Update title text and list view
    document.getElementById('unit-detail-title').textContent = GAME_LISTS.P1_UnitNameList[u.DT_Code];
    renderUnitsList();
  });

  document.getElementById('unit-sonzai-check').addEventListener('change', (e) => {
    if (selectedUnitIdx === -1) return;
    const u = currentEditor.dataSet.unitDataSet[selectedUnitIdx];
    // 0 is exists, 8191 is non-existent
    u.DT_Sonzai = e.target.checked ? 0 : 8191;
  });

  document.getElementById('unit-og2-check').addEventListener('change', (e) => {
    if (selectedUnitIdx === -1) return;
    const u = currentEditor.dataSet.unitDataSet[selectedUnitIdx];
    u.DT_OG2Flag = e.target.checked;
  });

  document.getElementById('unit-full-bonus').addEventListener('change', (e) => {
    if (selectedUnitIdx === -1) return;
    const u = currentEditor.dataSet.unitDataSet[selectedUnitIdx];
    u.DT_Full = parseInt(e.target.value);
  });

  // Upgrades
  const setupUpgradeInput = (id, key) => {
    const range = document.getElementById(`${id}-range`);
    const valText = document.getElementById(`val-${id}`);
    range.addEventListener('input', (e) => {
      if (selectedUnitIdx === -1) return;
      const v = parseInt(e.target.value);
      valText.textContent = v;
      currentEditor.dataSet.unitDataSet[selectedUnitIdx][key] = v;
    });
  };
  setupUpgradeInput('unit-hp', 'DT_HP');
  setupUpgradeInput('unit-en', 'DT_EN');
  setupUpgradeInput('unit-undou', 'DT_Undou');
  setupUpgradeInput('unit-soukou', 'DT_Soukou');

  // Parts dropdowns
  for (let idx = 1; idx <= 4; idx++) {
    document.getElementById(`unit-parts-${idx}`).addEventListener('change', (e) => {
      if (selectedUnitIdx === -1) return;
      const u = currentEditor.dataSet.unitDataSet[selectedUnitIdx];
      const val = parseInt(e.target.value);
      u[`DT_Parts${idx}`] = val === 65535 ? 0 : val + 1; // 0이 미장착
    });
  }

  // Pilots mapping dropdowns
  for (let idx = 1; idx <= 4; idx++) {
    document.getElementById(`unit-pilot-${idx}`).addEventListener('change', (e) => {
      if (selectedUnitIdx === -1) return;
      const u = currentEditor.dataSet.unitDataSet[selectedUnitIdx];
      const val = parseInt(e.target.value);
      u[`DT_Pilot${idx}`] = val;
    });
  }

  // --- Pilot Tab Fields ---
  document.getElementById('pilot-code-select').addEventListener('change', (e) => {
    if (selectedPilotIdx === -1) return;
    const p = currentEditor.dataSet.pilotDataSet[selectedPilotIdx];
    p.DT_Code = parseInt(e.target.value);
    
    document.getElementById('pilot-detail-title').textContent = GAME_LISTS.P3_PilotNameList[p.DT_Code];
    renderPilotsList();
  });

  document.getElementById('pilot-sonzai-check').addEventListener('change', (e) => {
    if (selectedPilotIdx === -1) return;
    const p = currentEditor.dataSet.pilotDataSet[selectedPilotIdx];
    p.DT_Sonzai = e.target.checked ? 0 : 8191; // 0 exists, 8191 non-exists
  });

  document.getElementById('pilot-og2-check').addEventListener('change', (e) => {
    if (selectedPilotIdx === -1) return;
    const p = currentEditor.dataSet.pilotDataSet[selectedPilotIdx];
    p.DT_OG2Flag = e.target.checked;
  });

  document.getElementById('pilot-unit-id').addEventListener('input', (e) => {
    if (selectedPilotIdx === -1) return;
    const p = currentEditor.dataSet.pilotDataSet[selectedPilotIdx];
    p.DT_Unit = parseInt(e.target.value) || 65535;
  });

  document.getElementById('pilot-cgflag-check').addEventListener('change', (e) => {
    if (selectedPilotIdx === -1) return;
    const p = currentEditor.dataSet.pilotDataSet[selectedPilotIdx];
    p.DT_CGFlag = e.target.checked;
  });

  // Numeric binds
  const bindNumericField = (elId, key, maxVal) => {
    document.getElementById(elId).addEventListener('input', (e) => {
      if (selectedPilotIdx === -1) return;
      const p = currentEditor.dataSet.pilotDataSet[selectedPilotIdx];
      let v = parseInt(e.target.value) || 0;
      v = Math.min(maxVal, Math.max(0, v));
      e.target.value = v;
      p[key] = v;
    });
  };
  bindNumericField('pilot-pp', 'DT_PP', 99999);
  bindNumericField('pilot-kills', 'DT_Kill', 9999);
  bindNumericField('pilot-ex', 'DT_Ex', 999999);
  bindNumericField('pilot-kakuto', 'DT_Kakuto', 999);
  bindNumericField('pilot-syageki', 'DT_Syageki', 999);
  bindNumericField('pilot-bougyo', 'DT_Bougyo', 999);
  bindNumericField('pilot-giryo', 'DT_Giryo', 999);
  bindNumericField('pilot-kaihi', 'DT_Kaihi', 999);
  bindNumericField('pilot-meicyu', 'DT_Meicyu', 999);

  // Terrain adp binds
  const bindAdpSelect = (elId, key) => {
    document.getElementById(elId).addEventListener('change', (e) => {
      if (selectedPilotIdx === -1) return;
      const p = currentEditor.dataSet.pilotDataSet[selectedPilotIdx];
      p[key] = parseInt(e.target.value);
    });
  };
  bindAdpSelect('pilot-adp-air', 'DT_Tchikei1');
  bindAdpSelect('pilot-adp-ground', 'DT_Tchikei2');
  bindAdpSelect('pilot-adp-water', 'DT_Tchikei3');
  bindAdpSelect('pilot-adp-space', 'DT_Tchikei4');

  // --- Weapon Tab Fields ---
  document.getElementById('weapon-code-select').addEventListener('change', (e) => {
    if (selectedWeaponIdx === -1) return;
    const b = currentEditor.dataSet.bukikoDataSet[selectedWeaponIdx];
    b.DT_Code = parseInt(e.target.value);
    
    const listSource = b.DT_OG2Flag ? GAME_LISTS.P2_1_KansoBukiNameListOG2 : GAME_LISTS.P2_1_KansoBukiNameListOG1;
    document.getElementById('weapon-detail-title').textContent = listSource[b.DT_Code];
    renderWeaponsList();
  });

  document.getElementById('weapon-og2-check').addEventListener('change', (e) => {
    if (selectedWeaponIdx === -1) return;
    const b = currentEditor.dataSet.bukikoDataSet[selectedWeaponIdx];
    b.DT_OG2Flag = e.target.checked;
    
    // Remap dropdown content
    const listSource = b.DT_OG2Flag ? GAME_LISTS.P2_1_KansoBukiNameListOG2 : GAME_LISTS.P2_1_KansoBukiNameListOG1;
    fillSelectOptions('weapon-code-select', listSource);
    codeSelect.value = b.DT_Code;
    renderWeaponsList();
  });

  document.getElementById('weapon-soubi-check').addEventListener('change', (e) => {
    if (selectedWeaponIdx === -1) return;
    const b = currentEditor.dataSet.bukikoDataSet[selectedWeaponIdx];
    b.DT_SoubiFlag = e.target.checked ? 1 : 0;
    renderWeaponsList();
  });

  document.getElementById('weapon-tama-id').addEventListener('input', (e) => {
    if (selectedWeaponIdx === -1) return;
    const b = currentEditor.dataSet.bukikoDataSet[selectedWeaponIdx];
    let v = parseInt(e.target.value) || 0;
    v = Math.min(255, Math.max(0, v));
    e.target.value = v;
    b.DT_Tama = v;
  });

  // Weapon Upgrade Range
  const rangeB = document.getElementById('weapon-kaizou-range');
  const valTextB = document.getElementById('val-weapon-kaizou');
  rangeB.addEventListener('input', (e) => {
    if (selectedWeaponIdx === -1) return;
    const v = parseInt(e.target.value);
    valTextB.textContent = v;
    currentEditor.dataSet.bukikoDataSet[selectedWeaponIdx].DT_Kaizou = v;
    renderWeaponsList();
  });

  // --- Tama (특수탄) Tab Fields ---
  document.getElementById('tama-name').addEventListener('input', (e) => {
    if (selectedTamaIdx === -1) return;
    const t = currentEditor.dataSet.tamaDataSet[selectedTamaIdx];
    t.Name = e.target.value.trim();
    
    document.getElementById('tama-detail-title').textContent = t.Name !== "" ? t.Name : "이름 없음";
    renderTamaList();
  });

  const bindTamaSozai = (elId, key) => {
    document.getElementById(elId).addEventListener('change', (e) => {
      if (selectedTamaIdx === -1) return;
      const t = currentEditor.dataSet.tamaDataSet[selectedTamaIdx];
      const val = parseInt(e.target.value);
      t[key] = val === 65535 ? 255 : val;
    });
  };
  bindTamaSozai('tama-sozai1', 'Sozai1');
  bindTamaSozai('tama-sozai2', 'Sozai2');
  bindTamaSozai('tama-sozai3', 'Sozai3');

  document.getElementById('tama-sonzai-check').addEventListener('change', (e) => {
    if (selectedTamaIdx === -1) return;
    const t = currentEditor.dataSet.tamaDataSet[selectedTamaIdx];
    t.Sonzai = e.target.checked ? 1 : 0;
  });

  const bindTamaNumeric = (elId, key, minVal, maxVal) => {
    document.getElementById(elId).addEventListener('input', (e) => {
      if (selectedTamaIdx === -1) return;
      const t = currentEditor.dataSet.tamaDataSet[selectedTamaIdx];
      let v = parseInt(e.target.value) || 0;
      v = Math.min(maxVal, Math.max(minVal, v));
      e.target.value = v;
      t[key] = v;
    });
  };
  bindTamaNumeric('tama-kougeki', 'Kougeki', -32768, 32767);
  bindTamaNumeric('tama-syatei', 'Syatei', -128, 127);
  bindTamaNumeric('tama-meicyu', 'Meicyu', -32768, 32767);
  bindTamaNumeric('tama-critical', 'Critical', -32768, 32767);
  bindTamaNumeric('tama-count', 'Tama', -128, 127);
  bindTamaNumeric('tama-kiryoku', 'Kiryoku', -128, 127);

  const bindTamaAdp = (elId, key) => {
    document.getElementById(elId).addEventListener('change', (e) => {
      if (selectedTamaIdx === -1) return;
      const t = currentEditor.dataSet.tamaDataSet[selectedTamaIdx];
      t[key] = parseInt(e.target.value);
    });
  };
  bindTamaAdp('tama-adp-air', 'Tchikei1');
  bindTamaAdp('tama-adp-ground', 'Tchikei2');
  bindTamaAdp('tama-adp-water', 'Tchikei3');
  bindTamaAdp('tama-adp-space', 'Tchikei4');

  document.getElementById('tama-tokusyu').addEventListener('change', (e) => {
    if (selectedTamaIdx === -1) return;
    const t = currentEditor.dataSet.tamaDataSet[selectedTamaIdx];
    t.Tokusyu = parseInt(e.target.value);
  });

  document.getElementById('tama-tokusyulv').addEventListener('input', (e) => {
    if (selectedTamaIdx === -1) return;
    const t = currentEditor.dataSet.tamaDataSet[selectedTamaIdx];
    let v = parseInt(e.target.value) || 0;
    v = Math.min(3, Math.max(0, v));
    e.target.value = v;
    t.TokusyuLv = v;
  });

  document.getElementById('tama-baria').addEventListener('change', (e) => {
    if (selectedTamaIdx === -1) return;
    const t = currentEditor.dataSet.tamaDataSet[selectedTamaIdx];
    t.Baria = parseInt(e.target.value);
  });

  document.getElementById('tama-pzokusei-check').addEventListener('change', (e) => {
    if (selectedTamaIdx === -1) return;
    const t = currentEditor.dataSet.tamaDataSet[selectedTamaIdx];
    t.PZokusei = e.target.checked ? 1 : 0;
  });
}
