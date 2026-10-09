// index.js — TZ manual (lista hispana) + cron 07:30/19:30 + recorrer TODOS los canales de voz
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const cron = require('node-cron');

function serializeLogFields(fields = {}) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join(' ');
}

function info(scope, event, fields = {}) {
  const details = serializeLogFields(fields);
  console.log(`[730][${scope}] ${event}${details ? ` ${details}` : ''}`);
}

function warn(event, fields = {}) {
  const details = serializeLogFields(fields);
  console.warn(`[730][WARN] ${event}${details ? ` ${details}` : ''}`);
}

function error(event, fields = {}) {
  const details = serializeLogFields(fields);
  console.error(`[730][ERROR] ${event}${details ? ` ${details}` : ''}`);
}

// ===== Config global =====
const AUDIO_FILE = process.env.AUDIO_FILE || path.join(__dirname, 'audio', 'sonido.mp3');
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { error('missing_discord_token'); process.exit(1); }

// ===== Persistencia por servidor =====
// Estructura: { [guildId]: { tz?: string } }
const CONFIG_DIR = path.resolve('data');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
function ensureConfigFile() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '{}', 'utf8');
}
function readConfig() { ensureConfigFile(); try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; } }
function writeConfig(cfg) { ensureConfigFile(); fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8'); }

// ===== Zonas IANA de países hispanohablantes =====
const ALLOWED_TZS = [
  'Europe/Madrid','Atlantic/Canary',
  'America/Mexico_City','America/Argentina/Buenos_Aires','America/Santiago',
  'America/Bogota','America/Lima','America/Guayaquil','America/La_Paz',
  'America/Asuncion','America/Montevideo','America/Caracas',
  'America/Guatemala','America/Tegucigalpa','America/El_Salvador',
  'America/Managua','America/Costa_Rica','America/Panama',
  'America/Havana','America/Santo_Domingo','America/Puerto_Rico',
  'Africa/Malabo'
];
const TZ_NICE = {
  'Europe/Madrid': 'Madrid (España pen.)',
  'Atlantic/Canary': 'Canarias (España)',
  'America/Mexico_City': 'CDMX (México)',
  'America/Argentina/Buenos_Aires': 'Buenos Aires (Argentina)',
  'America/Santiago': 'Santiago (Chile)',
  'America/Bogota': 'Bogotá (Colombia)',
  'America/Lima': 'Lima (Perú)',
  'America/Guayaquil': 'Guayaquil (Ecuador)',
  'America/La_Paz': 'La Paz (Bolivia)',
  'America/Asuncion': 'Asunción (Paraguay)',
  'America/Montevideo': 'Montevideo (Uruguay)',
  'America/Caracas': 'Caracas (Venezuela)',
  'America/Guatemala': 'Guatemala',
  'America/Tegucigalpa': 'Tegucigalpa (Honduras)',
  'America/El_Salvador': 'San Salvador (El Salvador)',
  'America/Managua': 'Managua (Nicaragua)',
  'America/Costa_Rica': 'San José (Costa Rica)',
  'America/Panama': 'Panamá',
  'America/Havana': 'La Habana (Cuba)',
  'America/Santo_Domingo': 'Santo Domingo (R. Dominicana)',
  'America/Puerto_Rico': 'San Juan (Puerto Rico)',
  'Africa/Malabo': 'Malabo (Guinea Ecuatorial)',
};

// Offset actual de una TZ (minutos) y etiqueta "UTC±HH(:MM)" considerando DST
function tzOffsetInfo(tz) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset'
  }).formatToParts(now);
  const offStr = parts.find(p => p.type === 'timeZoneName')?.value || '';
  const m = offStr.match(/([+-]\d{1,2})(?::?(\d{2}))?/);
  let offMin;
  if (m) {
    const h = parseInt(m[1], 10), mm = m[2] ? parseInt(m[2], 10) : 0;
    offMin = h * 60 + Math.sign(h) * mm;
  } else {
    // Fallback por conversión
    const localMs = now.getTime();
    const inTzMs = new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime();
    offMin = (inTzMs - localMs) / 60000 + now.getTimezoneOffset();
  }
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return { minutes: offMin, label: `UTC${sign}${hh}${mm !== '00' ? ':' + mm : ''}` };
}

// Opciones de select (hasta 25) ordenadas por offset y nombre
function buildTzSelectOptions() {
  const enriched = ALLOWED_TZS.map(tz => {
    const { minutes, label } = tzOffsetInfo(tz);
    return { tz, nice: TZ_NICE[tz] || tz, offsetMin: minutes, offsetLabel: label };
  });
  enriched.sort((a, b) => a.offsetMin - b.offsetMin || a.nice.localeCompare(b.nice, 'es'));
  return enriched.slice(0, 25).map(e => ({
    label: `${e.offsetLabel} — ${e.nice}`.slice(0, 100),
    value: e.tz,
    description: e.tz.slice(0, 100),
  }));
}


// Construye el selector reutilizable de zona horaria.
function buildTzSelectRow() {
  const options = buildTzSelectOptions();
  const select = new StringSelectMenuBuilder()
    .setCustomId('tz_select')
    .setPlaceholder('Seleccionar zona horaria')
    .addOptions(options.map(o => new StringSelectMenuOptionBuilder()
      .setLabel(o.label)
      .setValue(o.value)
      .setDescription(o.description)
    ));

  return new ActionRowBuilder().addComponents(select);
}

// Devuelve un canal de texto donde el bot pueda publicar el setup.
// Prioriza el canal del sistema del servidor.
function findSetupChannel(guild) {
  const me = guild.members.me;
  if (!me) return null;

  const canWrite = (ch) => {
    if (!ch) return false;
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) {
      return false;
    }

    const perms = ch.permissionsFor(me);
    return perms?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
    ]);
  };

  if (canWrite(guild.systemChannel)) {
    return guild.systemChannel;
  }

  return guild.channels.cache
    .filter(canWrite)
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .first() || null;
}

// Publica el setup inicial solamente si el servidor todavía no tiene TZ.
async function sendTimezoneSetup(guild) {
  const cfg = readConfig();

  if (cfg[guild.id]?.tz) {
    return;
  }

  const channel = findSetupChannel(guild);

  if (!channel) {
    warn('setup_channel_unavailable', { guild: guild.name });
    return;
  }

  await channel.send({
    content:
            `**Configuración inicial**\n` +
      `Antes de comenzar, seleccioná la zona horaria de este servidor.\n` +
      `7 30 utilizará esta configuración para ejecutar sus eventos a las **07:30** y **19:30**.`,
    components: [buildTzSelectRow()],
  });

  info('SETUP', 'sent', {
    guild: guild.name,
    channel: channel.name,
  });
}

// ===== Schedulers por servidor =====
/** Map<guildId, { jobs: cron.ScheduledTask[] }> */
const schedulers = new Map();

function clearSchedules(guildId) {
  const entry = schedulers.get(guildId);
  if (entry?.jobs) for (const j of entry.jobs) try { j.stop(); } catch {}
  schedulers.delete(guildId);
}

function scheduleForGuild(guildId, tz) {
  if (!tz) return;
  clearSchedules(guildId);
  const jobs = [
    cron.schedule('30 7 * * *', () => playAllInGuild(guildId),  { timezone: tz }),
    cron.schedule('30 19 * * *', () => playAllInGuild(guildId), { timezone: tz }),
  ];
  schedulers.set(guildId, { jobs });
  const guildName = client.guilds.cache.get(guildId)?.name || guildId;
  info('SCHED', 'configured', {
    guild: guildName,
    timezone: tz,
    times: '07:30,19:30',
  });
}

function ensureSchedulesFromConfig() {
  const cfg = readConfig();
  let changed = false;

  for (const [gid, rec] of Object.entries(cfg)) {
    if (!client.guilds.cache.has(gid)) {
      delete cfg[gid];
      clearSchedules(gid);
      changed = true;
      continue;
    }

    if (rec?.tz) {
      scheduleForGuild(gid, rec.tz);
    }
  }

  if (changed) {
    writeConfig(cfg);
  }
}

// ===== Cliente Discord =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// Registrar comandos slash en un guild
async function registerCommandsForGuild(guild) {
  const commands = [
    {
      name: 'settz',
      description: 'Elegí la zona horaria del servidor: enviá este comando para ver el selector.',
      dm_permission: false,
      default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    },
    {
      name: 'showconfig',
      description: 'Mostrar configuración actual',
      dm_permission: false,
    },
  ];
  await guild.commands.set(commands);
  info('CMD', 'registered', { guild: guild.name });
}

// ===== Reproducción =====

// Reproduce en un canal de voz y sale.
// Devuelve true solo si el audio realmente llegó a Playing y terminó en Idle.
async function playInChannel(guild, channel) {
  let conn = null;
  let player = null;

  try {
    if (!channel || channel.type !== ChannelType.GuildVoice) return false;

    // Validar audio
    if (!/^https?:\/\//i.test(AUDIO_FILE)) {
      const p = path.resolve(AUDIO_FILE);
      if (!fs.existsSync(p)) {
        throw new Error(`No encuentro el audio: ${p}`);
      }
    }

    info('VOICE', 'enter', {
      guild: guild.name,
      channel: channel.name,
    });

    conn = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    // Nunca esperar indefinidamente a que Discord conecte.
    await entersState(conn, VoiceConnectionStatus.Ready, 15_000);

    const resource = createAudioResource(AUDIO_FILE, { inlineVolume: true });
    resource.volume?.setVolume(1.0);

    player = createAudioPlayer();

    const subscription = conn.subscribe(player);
    if (!subscription) {
      throw new Error('No se pudo suscribir el reproductor a la conexión de voz');
    }

    player.play(resource);

    // Si en 8 segundos el audio no llegó realmente a Playing, es fallo.
    await entersState(player, AudioPlayerStatus.Playing, 8_000);

    info('PLAY', 'start', {
      guild: guild.name,
      channel: channel.name,
    });

    // Si el audio queda trabado, cortar este canal como máximo después de 30 s.
    await entersState(player, AudioPlayerStatus.Idle, 30_000);

    info('PLAY', 'done', {
      guild: guild.name,
      channel: channel.name,
    });
    return true;

  } catch (e) {
    error('playback_failed', {
      guild: guild?.name || 'unknown',
      channel: channel?.name || 'unknown',
      reason: e.message,
    });
    return false;

  } finally {
    try { player?.stop(true); } catch {}
    try { conn?.destroy(); } catch {}
  }
}

// Obtiene todos los canales de voz del guild en orden visual
function getAllVoiceChannelsSorted(guild) {
  return guild.channels.cache
    .filter(ch => ch.type === ChannelType.GuildVoice)
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .map(ch => ch);
}

// Reproduce en TODOS los canales uno a uno.
// Cada canal tiene un único reintento si la primera reproducción falla.
async function playAllInGuild(guildId) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const voiceChs = getAllVoiceChannelsSorted(guild);

    if (voiceChs.length === 0) {
      warn('no_voice_channels', { guild: guild.name });
      return;
    }

    info('RUN', 'start', {
      guild: guild.name,
      channels: voiceChs.length,
    });

    let okCount = 0;
    const failed = [];

    for (const ch of voiceChs) {
      let ok = await playInChannel(guild, ch);

      if (!ok) {
        warn('retry', {
          guild: guild.name,
          channel: ch.name,
        });
        await new Promise(r => setTimeout(r, 1500));
        ok = await playInChannel(guild, ch);
      }

      if (ok) {
        okCount++;
      } else {
        failed.push(ch.name);
        error('channel_failed', {
          guild: guild.name,
          channel: ch.name,
        });
      }

      await new Promise(r => setTimeout(r, 800));
    }

    if (failed.length === 0) {
      info('RUN', 'complete', {
        guild: guild.name,
        result: `${okCount}/${voiceChs.length}`,
      });
    } else {
      error('run_incomplete', {
        guild: guild.name,
        result: `${okCount}/${voiceChs.length}`,
        failed: failed.join(','),
      });
    }

  } catch (e) {
    error('run_failed', { reason: e.message });
  }
}

// ===== Eventos =====
client.once('clientReady', async () => {
  info('BOOT', 'connected', { user: client.user.tag });
  for (const [, guild] of client.guilds.cache) {
    try {
      await registerCommandsForGuild(guild);
    } catch (e) {
      error('command_registration_failed', { guild: guild.name, reason: e.message });
    }

    try {
      await sendTimezoneSetup(guild);
    } catch (e) {
      error('setup_failed', { guild: guild.name, reason: e.message });
    }
  }

  ensureSchedulesFromConfig();

  if (process.argv.includes('--now')) {
    const cfg = readConfig();
    for (const gid of Object.keys(cfg)) await playAllInGuild(gid);
  }
});

client.on('guildCreate', async (guild) => {
  try {
    await registerCommandsForGuild(guild);
  } catch (e) {
    error('command_registration_failed', { guild: guild.name, reason: e.message });
  }

  try {
    await sendTimezoneSetup(guild);
  } catch (e) {
    error('setup_failed', { guild: guild.name, reason: e.message });
  }
});


client.on('guildDelete', (guild) => {
  try {
    clearSchedules(guild.id);

    const cfg = readConfig();

    if (cfg[guild.id]) {
      delete cfg[guild.id];
      writeConfig(cfg);
    }

  } catch (e) {
    error('guild_cleanup_failed', { guild: guild.id, reason: e.message });
  }
});

client.on('interactionCreate', async (i) => {
  // /settz → menú
  if (i.isChatInputCommand() && i.commandName === 'settz') {
    await i.reply({
      content: 'Seleccioná la zona horaria de este servidor:',
      components: [buildTzSelectRow()],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // respuesta del menú /settz
  if (i.isStringSelectMenu() && i.customId === 'tz_select') {
    if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await i.reply({
        content: 'No tenés permisos para modificar la configuración de este servidor.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const tz = i.values[0];
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(); }
    catch { return i.reply({ content: 'Zona inválida.', flags: MessageFlags.Ephemeral }); }

    const cfg = readConfig();
    const rec = cfg[i.guildId] || {};
    rec.tz = tz;
    cfg[i.guildId] = rec;
    writeConfig(cfg);
    scheduleForGuild(i.guildId, tz);

    await i.update({ content: `Zona horaria: **${tz}**\nEventos: **07:30 / 19:30**`, components: [] });
    return;
  }

  // /showconfig
  if (i.isChatInputCommand() && i.commandName === 'showconfig') {
    const cfg = readConfig();
    const rec = cfg[i.guildId] || {};
    const tz = rec.tz || '*no definida*';
    await i.reply({
      content: `Zona horaria: **${tz}**
Eventos: **07:30 / 19:30**`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

});

client.login(TOKEN);
