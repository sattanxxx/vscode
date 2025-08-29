const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, VoiceConnectionStatus, entersState } = require("@discordjs/voice");
const prism = require("prism-media");
const { PassThrough } = require("stream");
const http = require("http");

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running!");
}).listen(PORT, () => console.log(`HTTPサーバー起動: ${PORT}`));

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const WAITING_VC_NAME = process.env.WAITING_VC_NAME || "スパイマスターVC";
const MEETING_VC_NAME = process.env.MEETING_VC_NAME || "諜報員VC";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let gameStarted = false;
let spymasters = { red: null, blue: null };
let agents = { red: [], blue: [] };
let monitoringConn = null;

// -----------------------------
// 複数ユーザー音声をミキシング
function mixAudioStreams(members, receiver) {
  const mixedStream = new PassThrough();

  members.forEach(member => {
    if (!member || !member.voice.channel || member.user.bot) return;
    try {
      const opusStream = receiver.subscribe(member.id, { end: { behavior: 0 } });
      const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
      opusStream.pipe(decoder).pipe(mixedStream, { end: false });
    } catch (err) {
      console.error(`⚠️ 音声取得エラー (${member.user.tag}): ${err.message}`);
    }
  });

  return mixedStream;
}

// -----------------------------
// VC移動関数
async function moveMembersToVC(members, vc) {
  for (const member of members) {
    if (!member || !member.voice) continue;
    if (member.voice.channelId !== vc.id) {
      try { await member.voice.setChannel(vc.id); } 
      catch { /* 無視 */ }
    }
  }
}

// -----------------------------
// ゲーム開始条件
function canStartGame() {
  return spymasters.red && spymasters.blue && agents.red.length > 0 && agents.blue.length > 0;
}

// ターン切替
async function startSpymasterTurn(meetingVC) {
  const allPlayers = [spymasters.red, spymasters.blue, ...agents.red, ...agents.blue];
  await moveMembersToVC(allPlayers, meetingVC);
}

async function startAgentTurn(waitingVC, meetingVC) {
  await moveMembersToVC([spymasters.red, spymasters.blue], waitingVC);
  const allAgents = [...agents.red, ...agents.blue];
  await moveMembersToVC(allAgents, meetingVC);
}

// -----------------------------
// 音声監視とミキシング再生
function monitorAndMix(meetingVC, waitingConn) {
  const members = meetingVC.members.filter(m => !m.user.bot);
  if (!members.length) return;

  const mixedStream = mixAudioStreams(members, waitingConn.receiver);

  const player = createAudioPlayer();
  const resource = createAudioResource(mixedStream);
  player.on("error", err => console.error(`AudioPlayer error: ${err.message}`));
  waitingConn.subscribe(player);
  player.play(resource);
}

// -----------------------------
client.once("ready", () => console.log(`✅ Bot起動完了: ${client.user.tag}`));

client.on("messageCreate", async message => {
  if (!message.content.startsWith("/")) return;
  const [command, ...args] = message.content.split(" ");
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  const channels = await guild.channels.fetch();
  const waitingVC = channels.find(c => c.name === WAITING_VC_NAME && c.type === 2);
  const meetingVC = channels.find(c => c.name === MEETING_VC_NAME && c.type === 2);
  if (!waitingVC || !meetingVC) return;

  try {
    // -----------------------------
    if (command === "/sr") {
      if (gameStarted) return message.reply("⚠️ ゲーム中は役職変更できません");
      const [team, role] = args;
      const member = message.mentions.members.first();
      if (!member) return message.reply("⚠️ メンバー指定が必要です");
      if (role === "sm") spymasters[team] = member;
      else if (role === "ag") agents[team].push(member);
      return message.reply("✅ 役職設定完了");
    }

    if (command === "/gs") {
      if (gameStarted) return message.reply("⚠️ ゲームは既に開始されています");
      if (!canStartGame()) return message.reply("⚠️ 役職設定が未完了です");
      gameStarted = true;

      monitoringConn = joinVoiceChannel({
        channelId: waitingVC.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator
      });

      monitoringConn.on("error", console.error);
      monitoringConn.on(VoiceConnectionStatus.Disconnected, async () => {
        console.log("⚠️ 待機VC接続切断。再接続を試みます...");
        try { await entersState(monitoringConn, VoiceConnectionStatus.Ready, 5000); }
        catch { monitoringConn.rejoin(); }
      });

      await startSpymasterTurn(meetingVC);
      monitorAndMix(meetingVC, monitoringConn);

      return message.reply("🎮 ゲーム開始！スパイマスターターンです");
    }

    if (command === "/t") {
      if (!gameStarted) return message.reply("⚠️ ゲーム未開始");
      const arg = args[0];
      if (arg === "sm") await startSpymasterTurn(meetingVC);
      else if (arg === "ag") await startAgentTurn(waitingVC, meetingVC);
      return message.reply(`ターン切替: ${arg}`);
    }

    if (command === "/ge") {
      if (!gameStarted) return message.reply("⚠️ ゲームは未開始です");
      gameStarted = false;

      if (monitoringConn && monitoringConn.state.status !== "destroyed") monitoringConn.destroy();
      monitoringConn = null;

      spymasters = { red: null, blue: null };
      agents = { red: [], blue: [] };

      return message.reply("🛑 ゲーム終了！役職リセット");
    }

    // -----------------------------
    // 役職確認コマンド
    if (command === "/cr") {
      const smRed = spymasters.red ? spymasters.red.user.tag : "未設定";
      const smBlue = spymasters.blue ? spymasters.blue.user.tag : "未設定";
      const agRed = agents.red.length ? agents.red.map(m => m.user.tag).join(", ") : "未設定";
      const agBlue = agents.blue.length ? agents.blue.map(m => m.user.tag).join(", ") : "未設定";

      return message.reply(`
      🎭 現在の役職設定
      スパイマスター赤: ${smRed}
      スパイマスター青: ${smBlue}
      諜報員赤: ${agRed}
      諜報員青: ${agBlue}
      `);
    }

  } catch (err) { console.error(err); }
});

client.login(TOKEN);
