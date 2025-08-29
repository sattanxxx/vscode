const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, EndBehaviorType } = require("@discordjs/voice");
const prism = require("prism-media");

// Render環境変数対応
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const SPYMASTER_VC_NAME = process.env.SPYMASTER_VC_NAME || "スパイマスターVC";
const AGENT_VC_NAME = process.env.AGENT_VC_NAME || "諜報員VC";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
    // VC操作のみなら MessageContent は不要
  ]
});

let spymasterConn = null;
let agentConn = null;
let bridgeActive = false;

client.once("ready", () => {
  console.log(`✅ Bot起動完了: ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (!message.content.startsWith("/turn")) return;

  const phase = message.content.split(" ")[1];
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  const spymasterVC = guild.channels.cache.find(c => c.name === SPYMASTER_VC_NAME);
  const agentVC = guild.channels.cache.find(c => c.name === AGENT_VC_NAME);
  if (!spymasterVC || !agentVC) return;

  // VCへBot参加（まだなら）
  if (!spymasterConn) {
    spymasterConn = joinVoiceChannel({
      channelId: spymasterVC.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator
    });
  }
  if (!agentConn) {
    agentConn = joinVoiceChannel({
      channelId: agentVC.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator
    });
  }

  if (phase === "spymaster") {
    bridgeActive = false;
    message.channel.send("🔵 スパイマスターターン：双方向会話OK");

  } else if (phase === "agent") {
    bridgeActive = true;
    message.channel.send("🟢 諜報員ターン：スパイマスターに諜報員の声をブリッジ");

    // Agent VC の音声をリッスンして Spymaster VC に転送
    const receiver = agentConn.receiver;

    agentVC.members.forEach(member => {
      if (member.user.bot) return;

      const audioStream = receiver.subscribe(member.id, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 100
        }
      });

      const opusDecoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000
      });

      const player = createAudioPlayer();
      const resource = createAudioResource(audioStream.pipe(opusDecoder));
      spymasterConn.subscribe(player);
      player.play(resource);
    });
  }
});

client.login(TOKEN);
