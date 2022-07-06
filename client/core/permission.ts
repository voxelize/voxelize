class Permission {
  /**
   * Whether or not can this client place/break blocks. Defaults to false.
   */
  public canUpdate = false;

  /**
   * Whether or not can this client fly. Defaults to false.
   */
  public canFly = false;

  /**
   * Whether or not can this client go to ghost mode. Defaults to false.
   */
  public canGhost = false;

  /**
   * Whether or not can this client view the debug screens. Defaults to false.
   */
  public canDebug = false;

  /**
   * Whether or not can this client chat. Default is true.
   */
  public canChat = true;

  public commands = [];
}
