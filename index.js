const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, EndBehaviorType } = require("@discordjs/voice");
const prism = require("prism-media");
const { Readable } = require("stream");
const http = require("http");

// -----------------------------
// Render 無料プラン向け軽量HTTPサーバー
// -----------------------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running!");
}).listen(PORT, () => console.log(`🌐 HTTPサーバー起動: ${PORT}`));

// -----------------------------
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

// -----------------------------
let spymasterConn = null;
let agentConn = null;
let gameStarted = false;

// -----------------------------
// 複数ユーザー同時発話ミキシング
// -----------------------------
function mixPCMStreams(streams) {
  const output = new Readable({ read() {} });
  const buffers = streams.map(() => Buffer.alloc(0));

  streams.forEach((stream, index) => {
    stream.on("data", (chunk) => {
      buffers[index] = Buffer.concat([buffers[index], chunk]);
      const minLength = Math.min(...buffers.map(b => b.length));
      if (minLength > 0) {
        const mixed = Buffer.alloc(minLength);
        for (let i = 0; i < minLength; i += 2) {
          let sum = 0;
          for (const buf of buffers) sum += buf.readInt16LE(i);
          if (sum > 32767) sum = 32767;
          if (sum < -32768) sum = -32768;
          mixed.writeInt16LE(sum, i);
        }
        output.push(mixed);
        for (let i = 0; i < buffers.length; i++) buffers[i] = buffers[i].slice(minLength);
      }
    });
    stream.on("end", () => output.push(null));
  });

  return output;
}

// -----------------------------
// VC間音声転送
// -----------------------------
function bridgeMultipleUsers(sourceConn, targetConn, members, label) {
  const pcmStreams = [];
  for (const member of members.values()) {
    if (!member || !member.user || member.user.bot) continue;

    const opusStream = sourceConn.receiver.subscribe(member.id, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 100 }
    });

    const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
    pcmStreams.push(opusStream.pipe(decoder));
  }

  if (pcmStreams.length === 0) return;

  const mixedStream = mixPCMStreams(pcmStreams);
  const resource = createAudioResource(mixedStream);
  const player = createAudioPlayer();
  targetConn.subscribe(player);
  player.play(resource);
  console.log(`🎤 ${label}: 複数メンバーの音声をミキシングして転送`);
}

// -----------------------------
client.once("ready", () => {
  console.log(`✅ Bot起動完了: ${client.user.tag}`);
});

// -----------------------------
client.on("messageCreate", async (message) => {
  if (!message.content.startsWith("/")) return;
  const [command, arg] = message.content.split(" ");
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  const channels = await guild.channels.fetch();
  const spymasterVC = channels.find(c => c.name === SPYMASTER_VC_NAME && c.type === 2);
  const agentVC = channels.find(c => c.name === AGENT_VC_NAME && c.type === 2);

  if (!spymasterVC || !agentVC) return;

  try {
    // -----------------------------
    // /gamestart（常に有効）
    // -----------------------------
    if (command === "/gamestart") {
      if (gameStarted) return message.channel.send("⚠️ 既にゲーム開始済みです。/gameend を実行してください。");

      spymasterConn = joinVoiceChannel({
        channelId: spymasterVC.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator
      });

      agentConn = joinVoiceChannel({
        channelId: agentVC.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator
      });

      gameStarted = true;
      message.channel.send("🎮 ゲーム開始！スパイマスターターンです。");

      // 初期ターン：双方向
      bridgeMultipleUsers(spymasterConn, agentConn, spymasterVC.members, "スパイマスター→諜報員");
      bridgeMultipleUsers(agentConn, spymasterConn, agentVC.members, "諜報員→スパイマスター");
      return;
    }

    // -----------------------------
    // ゲーム開始前は /turn /gameend 無効化
    // -----------------------------
    if (!gameStarted) {
      return message.channel.send("⚠️ まず /gamestart でゲームを開始してください。");
    }

    // -----------------------------
    // /turn
    // -----------------------------
    if (command === "/turn") {
      if (arg === "spymaster") {
        message.channel.send("🔵 スパイマスターターン：双方向会話");
        bridgeMultipleUsers(spymasterConn, agentConn, spymasterVC.members, "スパイマスター→諜報員");
        bridgeMultipleUsers(agentConn, spymasterConn, agentVC.members, "諜報員→スパイマスター");

      } else if (arg === "agent") {
        message.channel.send("🟢 諜報員ターン：スパイマスターはモニタリングのみ");
        bridgeMultipleUsers(agentConn, spymasterConn, agentVC.members, "諜報員→スパイマスター");
      }
      return;
    }

    // -----------------------------
    // /gameend
    // -----------------------------
    if (command === "/gameend") {
      if (spymasterConn) spymasterConn.destroy();
      if (agentConn) agentConn.destroy();
      spymasterConn = null;
      agentConn = null;
      gameStarted = false;

      message.channel.send("🛑 ゲーム終了！VCから退出しました。");
      return;
    }

    // -----------------------------
    // /help
    // -----------------------------
    if (command === "/help") {
      message.channel.send(`
🎮 Codenamesゲーム操作一覧
/gamestart → ゲーム開始（スパイマスターターンで開始）
/turn spymaster → スパイマスターターン
/turn agent → 諜報員ターン
/gameend → ゲーム終了
      `);
      return;
    }

  } catch (err) {
    console.error("⚠️ コマンド処理中のエラー:", err);
  }
});

client.login(TOKEN);
