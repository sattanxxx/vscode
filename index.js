const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, VoiceConnectionStatus, entersState } = require("@discordjs/voice");
const { PassThrough } = require("stream");
const WebSocket = require("ws");

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const WAITING_VC_NAME = process.env.WAITING_VC_NAME || "スパイマスターVC";
const MEETING_VC_NAME = process.env.MEETING_VC_NAME || "諜報員VC";
const WS_URL = process.env.WS_URL; // BOT2 WebSocket URL

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

let monitoringConn = null;
let audioPlayer = null;
let spymasters = { red: null, blue: null };
let players = [];
let isSpymasterTurn = true;
let ws = null;

async function moveMembersToVC(members, vc) {
  for (const member of members) {
    if (!member?.voice?.channelId) continue;
    if (member.voice.channelId !== vc.id) {
      try { await member.voice.setChannel(vc.id); } catch {}
    }
  }
}

async function toggleTurn(waitingVC, meetingVC) {
  if (isSpymasterTurn) {
    await moveMembersToVC([spymasters.red, spymasters.blue].filter(Boolean), waitingVC);
    await moveMembersToVC(players, meetingVC);
  } else {
    await moveMembersToVC([spymasters.red, spymasters.blue, ...players].filter(Boolean), meetingVC);
  }
  isSpymasterTurn = !isSpymasterTurn;
}

client.once("ready", async () => {
  console.log(`✅ BOT1 起動: ${client.user.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = await guild.channels.fetch();
  const waitingVC = channels.find(c => c.name === WAITING_VC_NAME && c.type === 2);
  if (!waitingVC) return console.error("待機VC未検出");

  monitoringConn = joinVoiceChannel({
    channelId: waitingVC.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator
  });
  await entersState(monitoringConn, VoiceConnectionStatus.Ready, 20000);

  audioPlayer = createAudioPlayer();
  monitoringConn.subscribe(audioPlayer);

  ws = new WebSocket(WS_URL);
  ws.on("open", () => console.log("✅ BOT2 接続確立"));
  ws.on("message", msg => {
    const stream = new PassThrough();
    stream.end(msg);
    const resource = createAudioResource(stream, { inputType: "pcm16" });
    audioPlayer.play(resource);
  });
  setInterval(() => { if(ws.readyState === WebSocket.OPEN) ws.send("ping"); }, 5000);
  ws.on("message", msg => { if(msg.toString() === "pong") console.log("BOT2疎通OK"); });
});

// --------------------
// メッセージコマンド処理
client.on("messageCreate", async message => {
  if (!message.content.startsWith("//")) return;
  const [command, ...args] = message.content.split(" ");
  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = await guild.channels.fetch();
  const waitingVC = channels.find(c => c.name === WAITING_VC_NAME && c.type === 2);
  const meetingVC = channels.find(c => c.name === MEETING_VC_NAME && c.type === 2);

  try {
    if (command === "//sm") {
      const [team] = args;
      const member = message.mentions.members.first();
      if (!member || !["red","blue"].includes(team)) return;
      spymasters[team] = member;
      return message.reply(`✅ ${team}スパイマスター設定`);
    }

    if (command === "//player") {
      const member = message.mentions.members.first();
      if (!member) return;
      if (!players.includes(member)) players.push(member);
      return message.reply(`✅ プレイヤー追加: ${member.user.tag}`);
    }

    if (command === "//cr") {
      const smRed = spymasters.red ? spymasters.red.user.tag : "未設定";
      const smBlue = spymasters.blue ? spymasters.blue.user.tag : "未設定";
      const pl = players.length ? players.map(m=>m.user.tag).join(","):"未設定";
      return message.reply(`スパイマスター赤:${smRed}\nスパイマスター青:${smBlue}\nプレイヤー:${pl}`);
    }

    if (command === "//gs") {
      const all = [spymasters.red, spymasters.blue, ...players];
      // const notInVC = all.filter(m => !m?.voice?.channel);
      // if(notInVC.length) return message.reply(`⚠️ VC未接続: ${notInVC.map(m=>m.user.tag).join(",")}`);
      await moveMembersToVC(all.filter(Boolean), meetingVC);
      return message.reply("🎮 ゲーム開始！全員会議VCに集合");
    }

    if (command === "//t") {
      await toggleTurn(waitingVC, meetingVC);
      return message.reply(`🔄 ターン切替: ${isSpymasterTurn ? "スパイマスター":"プレイヤー"}`);
    }

    if (command === "//ge") {
      const all = [spymasters.red, spymasters.blue, ...players].filter(Boolean);
      await moveMembersToVC(all, meetingVC);
      spymasters = { red:null, blue:null };
      players = [];
      isSpymasterTurn = true;
      return message.reply("🛑 ゲーム終了");
    }

  } catch(e){ console.error(e); }
});

client.login(TOKEN);
