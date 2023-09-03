import { CornerData, UV } from ".";

export type Face = {
  name: string;
  independent: boolean;
  dir: [number, number, number];
  corners: [CornerData, CornerData, CornerData, CornerData];
  range: UV;
};
