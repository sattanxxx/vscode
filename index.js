const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, EndBehaviorType } = require("@discordjs/voice");
const prism = require("prism-media");
const http = require("http");

// ダミー HTTP サーバー（Render Web Service用）
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running!");
}).listen(PORT, () => console.log(`🌐 HTTPサーバー起動: ${PORT}`));

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const SPYMASTER_VC_NAME = process.env.SPYMASTER_VC_NAME || "スパイマスターVC";
const AGENT_VC_NAME = process.env.AGENT_VC_NAME || "諜報員VC";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let agentConn = null;
let bridgeActive = false; // true = 諜報員ターン（スパイマスター音声は届かない）

client.once("ready", () => {
  console.log(`✅ Bot起動完了: ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (!message.content.startsWith("/")) return;

  const [command, arg] = message.content.split(" ");
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  const channels = await guild.channels.fetch();
  const spymasterVC = channels.find(c => c.name === SPYMASTER_VC_NAME && c.type === 2);
  const agentVC = channels.find(c => c.name === AGENT_VC_NAME && c.type === 2);

  if (!agentVC) return console.log("⚠️ 諜報員VCが見つかりません");
  if (!spymasterVC) console.log("⚠️ スパイマスターVCが見つかりません");

  // -----------------------------
  // /gamestart
  // -----------------------------
  if (command === "/gamestart") {
    if (!agentConn) {
      agentConn = joinVoiceChannel({
        channelId: agentVC.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator
      });
      console.log("✅ 諜報員VCに参加しました");
    }
    message.channel.send("🎮 ゲーム開始！Botが諜報員VCに参加しました。");
    return;
  }

  // -----------------------------
  // /turn
  // -----------------------------
  if (command === "/turn") {
    // -----------------------------
    // スパイマスターターン
    // -----------------------------
    if (arg === "spymaster") {
      bridgeActive = false;
      message.channel.send("🔵 スパイマスターターン：諜報員VCで双方向会話、スパイマスター音声を転送");

      if (!agentConn || !spymasterVC) return;

      const receiver = agentConn.receiver;

      // スパイマスターVCの音声を取得して諜報員VCに転送
      spymasterVC.members.forEach(member => {
        if (member.user.bot) return;

        const audioStream = receiver.subscribe(member.id, {
          end: { behavior: EndBehaviorType.AfterSilence, duration: 100 }
        });

        const opusDecoder = new prism.opus.Decoder({
          frameSize: 960,
          channels: 2,
          rate: 48000
        });

        const player = createAudioPlayer();
        const resource = createAudioResource(audioStream.pipe(opusDecoder));
        agentConn.subscribe(player);
        player.play(resource);
      });

      // 諜報員VC内はBotを介さず双方向会話可能

    // -----------------------------
    // 諜報員ターン
    // -----------------------------
    } else if (arg === "agent") {
      bridgeActive = true;
      message.channel.send("🟢 諜報員ターン：諜報員VCで双方向会話、スパイマスターはモニタリングのみ");

      // 諜報員VCの音声をスパイマスターに転送（モニタリング）
      if (spymasterVC) {
        const receiver = agentConn.receiver;

        agentVC.members.forEach(member => {
          if (member.user.bot) return;

          const audioStream = receiver.subscribe(member.id, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 100 }
          });

          const opusDecoder = new prism.opus.Decoder({
            frameSize: 960,
            channels: 2,
            rate: 48000
          });

          const player = createAudioPlayer();
          const resource = createAudioResource(audioStream.pipe(opusDecoder));
          // モニタリング用なので agentConn に送信は不要
          player.play(resource);
        });
      }
    }
    return;
  }

  // -----------------------------
  // /gameend
  // -----------------------------
  if (command === "/gameend") {
    if (agentConn) {
      agentConn.destroy();
      agentConn = null;
      console.log("✅ 諜報員VCから退出");
    }

    bridgeActive = false;
    message.channel.send("🛑 ゲーム終了！Botは諜報員VCから退出しました。");
    return;
  }
});

client.login(TOKEN);
