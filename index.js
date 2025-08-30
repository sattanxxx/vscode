// bot1.js
const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require("@discordjs/voice");
const WebSocket = require("ws");

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const WAITING_VC_NAME = process.env.WAITING_VC_NAME || "スパイマスターVC";
const MEETING_VC_NAME = process.env.MEETING_VC_NAME || "諜報員VC";
const BOT2_WS_URL = process.env.BOT2_WS_URL || "ws://testrepo.onrender.com";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let spymasters = { red: null, blue: null };
let players = [];
let isSpymasterTurn = true;
let gameStarted = false;
let monitoringConn = null;
let ws = null;

// -----------------
// BOT2 WebSocket接続
function connectToBot2() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket(BOT2_WS_URL);

  ws.on("open", () => console.log("✅ BOT2(testrepo)と接続完了"));
  ws.on("ping", () => ws.pong());
  ws.on("close", () => {
    console.log("⚠️ BOT2接続切断、再接続を試みます...");
    setTimeout(connectToBot2, 5000);
  });
  ws.on("error", (err) => console.error("BOT2 WSエラー:", err));
  ws.on("message", (data) => {
    if (!monitoringConn) return;
    try {
      const player = createAudioPlayer();
      const resource = createAudioResource(data);
      monitoringConn.subscribe(player);
      player.play(resource);
    } catch (err) { console.error(err); }
  });
}

// -----------------
// VC移動関数
async function moveMembersToVC(members, vc) {
  for (const member of members) {
    if (!member || !member.voice) continue;
    if (member.voice.channelId !== vc.id) {
      try { await member.voice.setChannel(vc.id); } catch { }
    }
  }
}

// -----------------
// ゲーム開始条件
function canStartGame() {
  return spymasters.red && spymasters.blue && players.length > 0;
}

// -----------------
// ターン切替
async function toggleTurn(waitingVC, meetingVC) {
  if (isSpymasterTurn) {
    await moveMembersToVC([spymasters.red, spymasters.blue].filter(Boolean), waitingVC);
    await moveMembersToVC(players, meetingVC);
  } else {
    await moveMembersToVC([spymasters.red, spymasters.blue, ...players].filter(Boolean), meetingVC);
  }
  isSpymasterTurn = !isSpymasterTurn;
}

// -----------------
client.once("ready", () => {
  console.log(`✅ BOT1(vscode)起動完了: ${client.user.tag}`);
  connectToBot2();
});

client.on("messageCreate", async message => {
  if (!message.content.startsWith("//")) return;
  const [command, ...args] = message.content.split(" ");
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;
  const channels = await guild.channels.fetch();
  const waitingVC = channels.find(c => c.name === WAITING_VC_NAME && c.type === 2);
  const meetingVC = channels.find(c => c.name === MEETING_VC_NAME && c.type === 2);
  if (!waitingVC || !meetingVC) return;

  try {
    // -----------------
    // スパイマスター設定
    if (command === "//sm") {
      if (gameStarted) return message.reply("⚠️ ゲーム中は役職変更できません");
      const [team] = args;
      const member = message.mentions.members.first();
      if (!member) return message.reply("⚠️ メンバー指定が必要です");
      if (team !== "red" && team !== "blue") return message.reply("⚠️ teamはredかblueを指定");
      spymasters[team] = member;
      return message.reply(`✅ ${team}スパイマスターを設定しました`);
    }

    // -----------------
    // プレイヤー追加
    if (command === "//player") {
      if (gameStarted) return message.reply("⚠️ ゲーム中は変更できません");
      const member = message.mentions.members.first();
      if (!member) return message.reply("⚠️ メンバー指定が必要です");
      if (!players.includes(member)) players.push(member);
      return message.reply(`✅ プレイヤーに追加しました: ${member.user.tag}`);
    }

    // -----------------
    // 役職確認
    if (command === "//cr") {
      const smRed = spymasters.red ? spymasters.red.user.tag : "未設定";
      const smBlue = spymasters.blue ? spymasters.blue.user.tag : "未設定";
      const playerList = players.length ? players.map(m => m.user.tag).join(", ") : "未設定";
      return message.reply(`
🎭 役職確認
スパイマスター赤: ${smRed}
スパイマスター青: ${smBlue}
プレイヤー: ${playerList}`);
    }

    // -----------------
    // ゲーム開始
    if (command === "//gs") {
      if (gameStarted) return message.reply("⚠️ ゲームは既に開始されています");
      if (!canStartGame()) return message.reply("⚠️ 役職設定が未完了です");

      const allPlayers = [spymasters.red, spymasters.blue, ...players];
      const notInVC = allPlayers.filter(m => !m.voice || !m.voice.channel);
      if (notInVC.length > 0) {
        return message.reply(`⚠️ 以下のメンバーがVCに接続していません:\n${notInVC.map(m => m.user.tag).join("\n")}`);
      }

      gameStarted = true;
      isSpymasterTurn = true;

      // 会議VCに全員を集める
      await moveMembersToVC(allPlayers.filter(Boolean), meetingVC);

      // 待機VCにBOT1接続
      monitoringConn = joinVoiceChannel({ channelId: waitingVC.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });

      return message.reply("🎮 ゲーム開始！全員会議VCに集めました。スパイマスターターンです");
    }

    // -----------------
    // ターン切替
    if (command === "//t") {
      if (!gameStarted) return message.reply("⚠️ ゲーム未開始");
      await toggleTurn(waitingVC, meetingVC);
      return message.reply(`🔄 ターン切替: ${isSpymasterTurn ? "スパイマスター" : "諜報員"}`);
    }

    // -----------------
    // ゲーム終了
    if (command === "//ge") {
      if (!gameStarted) return message.reply("⚠️ ゲームは未開始です");
      gameStarted = false;
      const allPlayers = [spymasters.red, spymasters.blue, ...players].filter(Boolean);
      await moveMembersToVC(allPlayers, meetingVC);

      if (monitoringConn && monitoringConn.state.status !== "destroyed") monitoringConn.destroy();
      monitoringConn = null;

      spymasters = { red: null, blue: null };
      players = [];
      isSpymasterTurn = true;

      return message.reply("🛑 ゲーム終了！役職リセット");
    }
  } catch (err) { console.error(err); }
});

client.login(TOKEN);
