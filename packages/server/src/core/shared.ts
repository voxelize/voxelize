export type ClientFilter = {
  roomId?: string;
  exclude?: string[];
  include?: string[];
};

export const defaultFilter: ClientFilter = {
  roomId: "",
  exclude: [],
  include: [],
};
