/** Subset van de officiële CLIP API v2-resources die HomeOS gebruikt. */
export interface HueRef {
  rid: string;
  rtype: string;
}
export interface HueLight {
  id: string;
  type: "light";
  owner: HueRef;
  metadata: { name: string; archetype?: string };
  on: { on: boolean };
  dimming?: { brightness: number };
  color_temperature?: { mirek: number | null; mirek_valid?: boolean; mirek_schema?: { mirek_minimum: number; mirek_maximum: number } };
  color?: { xy: { x: number; y: number }; gamut?: { red: { x: number; y: number }; green: { x: number; y: number }; blue: { x: number; y: number } } };
}
export interface HueDevice {
  id: string;
  type: "device";
  metadata: { name: string };
  product_data?: { model_id?: string; manufacturer_name?: string; product_name?: string };
  services: HueRef[];
}
export interface HueRoom {
  id: string;
  type: "room";
  metadata: { name: string };
  children: HueRef[];
}
export interface HueZigbeeConnectivity {
  id: string;
  type: "zigbee_connectivity";
  owner: HueRef;
  status: "connected" | "disconnected" | "connectivity_issue" | "unidirectional_incoming";
}
export interface HueScene {
  id: string;
  type: "scene";
  metadata: { name: string };
  group: HueRef;
}
export interface HueList<T> {
  errors: { description: string }[];
  data: T[];
}
