class Permission {
  [key: string]: any;

  /**
   * Whether or not can this client fly. Defaults to false.
   */
  public readonly canFly: boolean = false;

  /**
   * Whether or not can this client go to ghost mode. Defaults to false.
   */
  public readonly canGhost: boolean = false;

  /**
   * Whether or not can this client view the debug screens. Defaults to false.
   */
  public readonly canDebug: boolean = false;

  /**
   * Whether or not can this client chat. Default is true.
   */
  public readonly canChat: boolean = true;

  /**
   * The list of commands that this client can use, client-side only.
   */
  public readonly commands: string | string[] = ["help"];

  constructor(permission: Partial<Permission> = {}) {
    Object.keys(permission).forEach((key) => (this[key] = permission[key]));
  }
}

export { Permission };
