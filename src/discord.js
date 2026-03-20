const config = require('./config');

class DiscordPresence {
  constructor(clientId) {
    this.clientId = clientId || config.DISCORD_CLIENT_ID;
    this.client = null;
    this.connected = false;
    this.reconnecting = false;
    this.destroyed = false;
  }

  async connect() {
    if (this.destroyed) return;

    try {
      // Try CJS require first, fall back to dynamic import for ESM
      let ClientClass;
      try {
        ({ Client: ClientClass } = require('@xhayper/discord-rpc'));
      } catch {
        ({ Client: ClientClass } = await import('@xhayper/discord-rpc'));
      }

      this.client = new ClientClass({ clientId: this.clientId });

      this.client.on('ready', () => {
        this.connected = true;
        this.reconnecting = false;
      });

      this.client.on('disconnected', () => {
        this.connected = false;
        if (!this.destroyed) this._scheduleReconnect();
      });

      await this.client.login();
      this.connected = true;
    } catch {
      this.connected = false;
      if (!this.destroyed) this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.reconnecting || this.destroyed) return;
    this.reconnecting = true;

    setTimeout(async () => {
      this.reconnecting = false;
      if (!this.destroyed) {
        await this.connect();
      }
    }, config.RECONNECT_INTERVAL_MS);
  }

  async setActivity(activityData) {
    if (!this.connected || !this.client || !this.client.user) return;

    try {
      await this.client.user.setActivity(activityData);
    } catch {
      this.connected = false;
      if (!this.destroyed) this._scheduleReconnect();
    }
  }

  async clearActivity() {
    if (!this.connected || !this.client || !this.client.user) return;

    try {
      await this.client.user.clearActivity();
    } catch {}
  }

  async destroy() {
    this.destroyed = true;
    this.connected = false;

    if (this.client) {
      try {
        await this.client.user?.clearActivity();
        await this.client.destroy();
      } catch {}
    }
  }
}

module.exports = DiscordPresence;
