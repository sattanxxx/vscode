const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, EndBehaviorType, VoiceConnectionStatus } = require("@discordjs/voice");
const prism = require("prism-media");
const http = require("http");

// Render 無料プラン向けダミーHTTPサーバー
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
let bridgeActive = false; // false=スパイマスターターン, true=諜報員ターン
let gameStarted = false;

client.once("ready", () => {
  console.log(`✅ Bot起動完了: ${client.user.tag}`);
});

// 音声転送の安全関数
async function safeAudioBridge(sourceMembers, receiverConn, targetConn, label) {
  if (!sourceMembers || !receiverConn || !targetConn) return;
  for (const member of sourceMembers) {
    if (member.user.bot) continue;
    try {
      const audioStream = receiverConn.receiver.subscribe(member.id, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 100 }
      });

      const opusDecoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000
      });

      const player = createAudioPlayer();
      const resource = createAudioResource(audioStream.pipe(opusDecoder));
      targetConn.subscribe(player);
      player.play(resource);

      console.log(`🎤 ${label}: ${member.user.tag} の音声を転送`);
    } catch (err) {
      console.error(`⚠️ ${label} 音声転送エラー (${member.user.tag}):`, err);
    }
  }
}

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

  try {
    // -----------------------------
    // /gamestart
    // -----------------------------
    if (command === "/gamestart") {
      if (gameStarted) {
        return message.channel.send("⚠️ 既にゲームは開始されています。/gameend を実行してください。");
      }

      if (!agentConn) {
        agentConn = joinVoiceChannel({
          channelId: agentVC.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator
        });

        agentConn.on(VoiceConnectionStatus.Disconnected, () => {
          console.log("⚠️ 諜報員VCから切断されました。再接続を試みます...");
          agentConn.rejoin();
        });

        console.log("✅ 諜報員VCに参加しました");
      }

      bridgeActive = false; // スパイマスターターン
      gameStarted = true;

      message.channel.send("🎮 ゲーム開始！Botが諜報員VCに参加しました。\n🔵 スパイマスターターンです。");
      return;
    }

    // -----------------------------
    // /turn
    // -----------------------------
    if (command === "/turn") {
      if (!gameStarted) {
        return message.channel.send("⚠️ まず /gamestart でゲームを開始してください。");
      }

      if (arg === "spymaster") {
        bridgeActive = false;
        message.channel.send("🔵 スパイマスターターン：諜報員VCで双方向会話、スパイマスター音声を転送");

        await safeAudioBridge(
          spymasterVC.members,
          agentConn,
          agentConn,
          "スパイマスターターン"
        );

      } else if (arg === "agent") {
        bridgeActive = true;
        message.channel.send("🟢 諜報員ターン：諜報員VCで双方向会話、スパイマスターはモニタリングのみ");

        await safeAudioBridge(
          agentVC.members,
          agentConn,
          agentConn,
          "諜報員ターン"
        );
      }
      return;
    }

    // -----------------------------
    // /gameend
    // -----------------------------
    if (command === "/gameend") {
      if (!gameStarted) {
        return message.channel.send("⚠️ ゲームは開始されていません。");
      }

      if (agentConn && agentConn.state.status !== "destroyed") {
        try {
          agentConn.destroy();
          console.log("✅ 諜報員VCから退出");
        } catch (err) {
          console.error("⚠️ VoiceConnection destroy エラー:", err);
        }
        agentConn = null;
      }

      bridgeActive = false;
      gameStarted = false;
      message.channel.send("🛑 ゲーム終了！Botは諜報員VCから退出しました。");
      return;
    }

    // -----------------------------
    // /help で定型文表示
    // -----------------------------
    if (command === "/help") {
      message.channel.send(`
🎮 Codenamesゲーム操作一覧
/gamestart → ゲーム開始（実行と同時にスパイマスターターンになります）
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
