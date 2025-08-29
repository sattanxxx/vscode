const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, EndBehaviorType } = require("@discordjs/voice");
const prism = require("prism-media");
const http = require("http");

// -----------------------------
// ダミー HTTP サーバー（Render Web Service用）
// -----------------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running!");
}).listen(PORT, () => console.log(`🌐 HTTPサーバー起動: ${PORT}`));

// -----------------------------
// Discord Bot 設定
// -----------------------------
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const SPYMASTER_VC_NAME = process.env.SPYMASTER_VC_NAME || "スパイマスターVC";
const AGENT_VC_NAME = process.env.AGENT_VC_NAME || "諜報員VC";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ]
});

let spymasterConn = null;
let agentConn = null;
let bridgeActive = false;

client.once("ready", () => {
  console.log(`✅ Bot起動完了: ${client.user.tag}`);
});

// -----------------------------
// コマンド処理
// -----------------------------
client.on("messageCreate", async (message) => {
  if (!message.content.startsWith("/")) return;

  const [command, arg] = message.content.split(" ");
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  const spymasterVC = guild.channels.cache.find(c => c.name === SPYMASTER_VC_NAME);
  const agentVC = guild.channels.cache.find(c => c.name === AGENT_VC_NAME);
  if (!spymasterVC || !agentVC) return;

  // -----------------------------
  // /gamestart コマンド
  // -----------------------------
  if (command === "/gamestart") {
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

    message.channel.send("🎮 ゲーム開始！Botが両方のVCに参加しました。");
    return;
  }

  // -----------------------------
  // /turn コマンド
  // -----------------------------
  if (command === "/turn") {
    if (arg === "spymaster") {
      bridgeActive = false;
      message.channel.send("🔵 スパイマスターターン：双方向会話OK");

    } else if (arg === "agent") {
      bridgeActive = true;
      message.channel.send("🟢 諜報員ターン：スパイマスターに諜報員の声をブリッジ");

      // Agent VC の音声を Spymaster VC に転送
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
  }
});

client.login(TOKEN);
