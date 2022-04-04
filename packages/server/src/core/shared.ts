/**
 * Broadcasting filter to include/exclude clients.
 */
export type ClientFilter = {
  roomId?: string;
  exclude?: string[];
  include?: string[];
};

/**
 * Default broadcasting filter.
 */
export const defaultFilter: ClientFilter = {
  roomId: "",
  exclude: [],
  include: [],
};
