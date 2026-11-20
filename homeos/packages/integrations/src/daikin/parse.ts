import { HVAC_MODES, type ClimateState, type HvacMode } from "@homeos/shared";

/** Subset van een Onecta gateway-device zoals de officiële API die teruggeeft. Alles is optioneel: defensief lezen. */
export interface OnectaCharacteristic<T = unknown> {
  value?: T;
  settable?: boolean;
  values?: string[];
  minValue?: number;
  maxValue?: number;
  stepValue?: number;
}
export interface OnectaManagementPoint {
  embeddedId: string;
  managementPointType: string;
  name?: OnectaCharacteristic<string>;
  modelInfo?: OnectaCharacteristic<string>;
  onOffMode?: OnectaCharacteristic<string>;
  operationMode?: OnectaCharacteristic<string>;
  temperatureControl?: OnectaCharacteristic<{ operationModes?: Record<string, { setpoints?: Record<string, OnectaCharacteristic<number>> }> }>;
  sensoryData?: OnectaCharacteristic<Record<string, OnectaCharacteristic<number>>>;
}
export interface OnectaDevice {
  id: string;
  deviceModel?: string;
  isCloudConnectionUp?: OnectaCharacteristic<boolean>;
  managementPoints: OnectaManagementPoint[];
}

export interface ParsedClimate {
  deviceId: string;
  embeddedId: string;
  name: string;
  model: string;
  online: boolean;
  on: boolean | null;
  canPower: boolean;
  canMode: boolean;
  canSetpoint: boolean;
  climate: ClimateState;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Setpoint voor de huidige modus (koelen/verwarmen/auto). Drogen en ventileren hebben er meestal geen. */
export function setpointFor(mp: OnectaManagementPoint, mode: string | null): OnectaCharacteristic<number> | null {
  if (!mode) return null;
  return mp.temperatureControl?.value?.operationModes?.[mode]?.setpoints?.roomTemperature ?? null;
}

export function parseClimate(device: OnectaDevice): ParsedClimate | null {
  const mp = device.managementPoints?.find((m) => m.managementPointType === "climateControl");
  if (!mp) return null;
  const gateway = device.managementPoints.find((m) => m.managementPointType === "gateway");
  const mode = typeof mp.operationMode?.value === "string" ? mp.operationMode.value : null;
  const modes = (mp.operationMode?.values ?? (mode ? [mode] : [])).filter((m): m is HvacMode => (HVAC_MODES as readonly string[]).includes(m));
  const sp = setpointFor(mp, mode);
  const sensors = mp.sensoryData?.value ?? {};
  return {
    deviceId: device.id,
    embeddedId: mp.embeddedId,
    name: (mp.name?.value || "Airco").slice(0, 80),
    model: (gateway?.modelInfo?.value || device.deviceModel || "Onecta").slice(0, 120),
    online: device.isCloudConnectionUp?.value !== false,
    on: mp.onOffMode?.value === "on" ? true : mp.onOffMode?.value === "off" ? false : null,
    canPower: mp.onOffMode?.settable !== false && mp.onOffMode?.value !== undefined,
    canMode: mp.operationMode?.settable !== false && modes.length > 1,
    canSetpoint: !!sp && sp.settable !== false,
    climate: {
      mode,
      modes,
      targetTempC: num(sp?.value),
      minTempC: num(sp?.minValue),
      maxTempC: num(sp?.maxValue),
      stepC: num(sp?.stepValue),
      roomTempC: num(sensors.roomTemperature?.value),
      outdoorTempC: num(sensors.outdoorTemperature?.value),
    },
  };
}
