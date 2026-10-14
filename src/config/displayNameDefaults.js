// Installation locations come from the supplied point list; metric values and units stay with the API.
const moduleNames = {
  VSE03: 'ZJ117 卷接机 · VE/MAX 风机振动',
  VSE04: 'ZB25 小盒包装机 · 电机与铝纸切刀振动',
  VSE05: 'ZB25 小盒包装机 · 主传动与封签振动',
  VSE08: 'YB55 硬条包装机 · 辅机振动',
  TEMP01: 'YB55 硬条包装机 · 辅机温度',
  TEMP02: 'ZJ117 卷接机 · VE/MAX 风机温度',
  TEMP03: 'ZB25 小盒包装机 · 主传动温度',
  PRESS01: 'ZB25 小盒包装机 · 负压',
  PRESS03: 'YB55 硬条包装机 · 主负压源',
  PRESS02: 'ZJ117 卷接机 · 蜘蛛手负压',
  SC01: 'ZB25 小盒包装机 · 主电机控制',
  SC02: 'YB55 硬条包装机 · 辅机控制',
}

const vibrationLocations = {
  VSE03: {
    SE01_v_01: 'VE 风机轴承座',
    SE01_v_02: 'VE 风机电机驱动端',
    SE01_v_03: 'MAX 风机轴承座',
    SE01_v_04: 'MAX 风机电机驱动端',
  },
  // Confirmed document: SE04 is the cutter; SE05 is the sealing component.
  // Translate display labels only; preserve point IDs, codes, axis suffixes and samples.
  VSE04: {
    SE04_v_01: '主电机驱动端',
    SE04_v_02: '铝纸切刀 X 轴',
    SE04_v_03: '铝纸切刀 Y 轴',
    SE04_v_04: '铝纸切刀 Z 轴',
  },
  VSE05: {
    SE05_v_01: '皮带轮轴承座',
    SE05_v_02: '封签部件 X 轴',
    SE05_v_03: '封签部件 Y 轴',
    SE05_v_04: '封签部件 Z 轴',
  },
  VSE08: {
    SE08_v_02: '辅机电机驱动端',
  },
}

const temperatureNames = {
  TEMP01: { BEARING_TEMP_01: '辅机电机温度' },
  TEMP03: { BEARING_TEMP_05: '主机电机温度', BEARING_TEMP_06: '主机皮带轮温度' },
  TEMP02: {
    BEARING_TEMP_07: 'MAX电机温度',
    BEARING_TEMP_08: 'MAX风机温度',
    BEARING_TEMP_09: 'VE电机温度',
    BEARING_TEMP_10: 'VE风机温度',
  },
}

const acousticChannelNames = {
  '192.168.3.51': { 1: 'VE 风机电机声纹', 2: 'VE 风机整体声纹' },
  '192.168.3.52': { 1: 'MAX 风机电机声纹', 2: 'MAX 风机整体声纹' },
  '192.168.3.53': { 1: '主机主电机声纹 · 通道1', 2: '主机主电机声纹 · 通道2' },
  '192.168.3.54': { 1: '齿轮箱声纹 · 通道1', 2: '齿轮箱声纹 · 通道2' },
  '192.168.3.55': { 1: '辅机主电机声纹 · 通道1', 2: '辅机主电机声纹 · 通道2' },
}
const acousticCollectorNames = {
  '192.168.3.51': 'VE 风机采集器',
  '192.168.3.52': 'MAX 风机采集器',
  '192.168.3.53': '主机主电机采集器',
  '192.168.3.54': '齿轮箱采集器',
  '192.168.3.55': '辅机主电机采集器',
}

export { moduleNames, vibrationLocations, temperatureNames, acousticChannelNames, acousticCollectorNames }
