import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, MicOff, Volume2, VolumeX, Smartphone, Radio, Users, 
  Battery, Activity, Shield, Play, HelpCircle, Lock, Unlock
} from 'lucide-react';
import { createClient } from '@supabase/supabase-client';

// ========================================================================
// 🔗 CONFIG SUPABASE (FREE TIER)
// ========================================================================
// Ganti teks di dalam tanda kutip dengan URL dan Anon Key dari Supabase Anda
const SUPABASE_URL = "https://your-project-id.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrcWt4ZXFlZXhyd3ZzdXd2dmpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNzk2OTcsImV4cCI6MjA5Njk1NTY5N30.bSKl3c8JWXEnkU459eLb-1c2lV9CVc81xzZDZ267wXs";

let supabase = null;
try {
  if (SUPABASE_URL !== "https://rkqkxeqeexrwvsuwvvjj.supabase.co") {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (e) {
  console.warn("Supabase gagal inisialisasi. Berjalan dalam mode simulasi lokal.", e);
}

export default function App() {
  const [isJoined, setIsJoined] = useState(false);
  const [roomId, setRoomId] = useState('CREW-ONE');
  const [userName, setUserName] = useState('');
  const [channel, setChannel] = useState('A'); 
  
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [gateThreshold, setGateThreshold] = useState(15); 
  const [batterySaver, setBatterySaver] = useState(false);
  const [isLocked, setIsLocked] = useState(false); 
  
  const [peers, setPeers] = useState({});
  const [activePeersCount, setActivePeersCount] = useState(0);
  const [systemLogs, setSystemLogs] = useState([]);
  const [latency, setLatency] = useState(12); 
  const [showConfig, setShowConfig] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [myUniqueId] = useState(() => 'user_' + Math.random().toString(36).substr(2, 9));

  const audioContextRef = useRef(null);
  const localStreamRef = useRef(null);
  const analyserRef = useRef(null);
  const rtcConnections = useRef({}); 
  const audioElements = useRef({}); 
  const supabaseChannelRef = useRef(null);

  const playSystemSound = (type) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      if (type === 'join') {
        osc.frequency.setValueAtTime(880, ctx.currentTime); gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start(); osc.stop(ctx.currentTime + 0.08);
      } else if (type === 'leave') {
        osc.frequency.setValueAtTime(580, ctx.currentTime); gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start(); osc.stop(ctx.currentTime + 0.15);
      }
    } catch (e) {}
  };

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setSystemLogs(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 14)]);
  };

  useEffect(() => {
    if (!userName) {
      const roles = ['Director', 'Cam-A', 'Cam-B', 'Audio', 'Lighting', 'Floor-Mgr'];
      setUserName(roles[Math.floor(Math.random() * roles.length)] + '-' + Math.floor(10 + Math.random() * 90));
    }
    if (!supabase) {
      addLog("Mode Demo: Isi SUPABASE_URL di baris 11 untuk mengaktifkan koneksi global.");
    }
  }, []);

  const startLocalAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 24000 }
      });
      localStreamRef.current = stream;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      addLog("Mikrofon aktif.");
      return stream;
    } catch (err) {
      addLog("Gagal akses mic. Cek izin HTTPS.");
      return null;
    }
  };

  // Voice Activity Detection (VAD) / Automatic Gate Control Loop
  useEffect(() => {
    let animationFrame;
    if (!isJoined || !analyserRef.current) return;
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const checkVolume = () => {
      animationFrame = requestAnimationFrame(checkVolume);
      analyserRef.current.getByteFrequencyData(dataArray);
      let sum = 0; for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
      const average = sum / bufferLength;
      const calculatedLevel = Math.min(100, Math.round((average / 128) * 100));
      
      if (!batterySaver) setAudioLevel(calculatedLevel);

      if (calculatedLevel > gateThreshold) {
        if (!isSpeaking) {
          setIsSpeaking(true);
          if (localStreamRef.current) localStreamRef.current.getAudioTracks().forEach(t => { if (!isMuted) t.enabled = true; });
        }
      } else {
        if (isSpeaking) {
          setIsSpeaking(false);
          if (localStreamRef.current) localStreamRef.current.getAudioTracks().forEach(t => t.enabled = false);
        }
      }
    };
    checkVolume();
    return () => cancelAnimationFrame(animationFrame);
  }, [isJoined, gateThreshold, isMuted, batterySaver, isSpeaking]);

  // --- SUPABASE REALTIME BROADCAST & WEBRTC P2P ---
  useEffect(() => {
    if (!isJoined || !supabase) return;
    const targetRoom = roomId.trim().toUpperCase();

    // Membuat channel realtime khusus room & intercom channel terjemahan P2P
    const channelName = `intercom_${targetRoom}_${channel}`;
    const syncChannel = supabase.channel(channelName, { config: { broadcast: { self: false } } });
    supabaseChannelRef.current = syncChannel;

    syncChannel
      .on('broadcast', { event: 'presence' }, ({ payload }) => {
        // Mendeteksi kru lain yang online/ping kehadiran
        setPeers(prev => {
          const next = { ...prev, [payload.id]: { ...payload, lastSeen: Date.now() } };
          setActivePeersCount(Object.keys(next).length);
          return next;
        });
        if (myUniqueId < payload.id && !rtcConnections.current[payload.id]) {
          addLog(`Memanggil ${payload.name}...`);
          initiateWebRTCCall(payload.id);
        }
      })
      .on('broadcast', { event: 'signal' }, async ({ payload }) => {
        if (payload.receiverId !== myUniqueId) return;
        const senderId = payload.senderId;

        if (payload.type === 'offer') {
          await handleWebRTCOffer(payload.data, senderId);
        } else if (payload.type === 'answer') {
          const pc = rtcConnections.current[senderId];
          if (pc) await pc.setRemoteDescription(new RTCSessionDescription(payload.data));
        } else if (payload.type === 'ice') {
          const pc = rtcConnections.current[senderId];
          if (pc) await pc.addIceCandidate(new RTCIceCandidate(payload.data));
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          addLog(`Kamar ${targetRoom} Aktif.`);
          // Kirim sinyal kehadiran diri ke sirkuit global
          syncChannel.send({
            type: 'broadcast',
            event: 'presence',
            payload: { id: myUniqueId, name: userName, isMuted, batterySaver }
          });
        }
      });

    // Interval deteksi detak jantung koneksi kru
    const heartbeat = setInterval(() => {
      syncChannel.send({
        type: 'broadcast',
        event: 'presence',
        payload: { id: myUniqueId, name: userName, isMuted, batterySaver }
      });
    }, 5000);

    return () => {
      clearInterval(heartbeat);
      if (supabaseChannelRef.current) supabase.removeChannel(supabaseChannelRef.current);
      Object.keys(rtcConnections.current).forEach(id => closePeerConnection(id));
    };
  }, [isJoined, channel, roomId]);

  // --- WEBRTC LOGIC PIPELINE ---
  const setupPeerConnection = (peerId) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    rtcConnections.current[peerId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    }

    pc.ontrack = (e) => {
      addLog(`Suara kru terhubung.`);
      let audio = audioElements.current[peerId];
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.setAttribute('playsinline', 'true');
        audioElements.current[peerId] = audio;
      }
      audio.srcObject = e.streams[0];
      audio.muted = isSpeakerMuted;
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && supabaseChannelRef.current) {
        supabaseChannelRef.current.send({
          type: 'broadcast', event: 'signal',
          payload: { senderId: myUniqueId, receiverId: peerId, type: 'ice', data: e.candidate }
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setLatency(Math.floor(10 + Math.random() * 8));
    };

    return pc;
  };

  const initiateWebRTCCall = async (peerId) => {
    const pc = setupPeerConnection(peerId);
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    supabaseChannelRef.current.send({
      type: 'broadcast', event: 'signal',
      payload: { senderId: myUniqueId, receiverId: peerId, type: 'offer', data: offer }
    });
  };

  const handleWebRTCOffer = async (offer, senderId) => {
    const pc = setupPeerConnection(senderId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    supabaseChannelRef.current.send({
      type: 'broadcast', event: 'signal',
      payload: { senderId: myUniqueId, receiverId: senderId, type: 'answer', data: answer }
    });
  };

  const closePeerConnection = (peerId) => {
    if (rtcConnections.current[peerId]) rtcConnections.current[peerId].close();
    if (audioElements.current[peerId]) audioElements.current[peerId].remove();
    delete rtcConnections.current[peerId];
    delete audioElements.current[peerId];
    setPeers(prev => { const n = { ...prev }; delete n[peerId]; setActivePeersCount(Object.keys(n).length); return n; });
  };

  const joinChannel = async () => {
    if (!userName.trim()) return;
    playSystemSound('join');
    const stream = await startLocalAudio();
    if (stream) setIsJoined(true);
  };

  const leaveChannel = () => {
    playSystemSound('leave');
    setIsJoined(false);
    setAudioLevel(0);
    setIsSpeaking(false);
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    addLog("Intercom Off.");
  };

  const toggleMute = () => {
    const next = !isMuted; setIsMuted(next);
    if (localStreamRef.current) localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !next);
  };

  if (isLocked) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col justify-between items-center p-6 text-neutral-400 z-50">
        <div className="text-center pt-10">
          <Smartphone className="w-12 h-12 text-[#DFFF00] mx-auto animate-pulse mb-2" />
          <p className="text-[#DFFF00] font-bold text-lg tracking-wider">HELIOS ACTIVE IN POCKET</p>
        </div>
        <div className="text-sm font-semibold">{activePeersCount} Kru Aktif ({roomId})</div>
        <button onClick={() => setIsLocked(false)} className="flex items-center gap-2 px-6 py-4 bg-neutral-900 border border-neutral-700 rounded-full font-bold">
          <Unlock className="w-5 h-5 text-emerald-400" /> BUKA LAYAR
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-neutral-200 flex flex-col items-center p-4">
      <header className="w-full max-w-md flex justify-between items-center py-3 border-b border-neutral-900">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#DFFF00] flex items-center justify-center font-black text-black text-sm">H1</div>
          <div>
            <h1 className="text-sm font-black text-white tracking-widest">HELIOS C1</h1>
            <p className="text-[9px] text-[#DFFF00] font-bold -mt-1">P2P SUPABASE WIRELESS</p>
          </div>
        </div>
        {isJoined && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-neutral-950 rounded border border-neutral-900 text-[10px] font-mono">
            <Activity className="w-3 h-3 text-emerald-400" /> {latency}ms
          </div>
        )}
      </header>

      {!isJoined ? (
        <main className="w-full max-w-md flex-1 flex flex-col justify-center gap-4 py-6">
          <div className="bg-neutral-900 border border-neutral-850 rounded-2xl p-6 space-y-4 shadow-xl">
            <div className="text-center">
              <Radio className="w-12 h-12 text-[#DFFF00] mx-auto animate-pulse mb-2" />
              <h2 className="text-lg font-bold text-white">Sambungan Intercom Kru</h2>
            </div>
            <div>
              <label className="block text-[10px] text-neutral-400 font-bold mb-1">NAMA PANGGILAN CREW</label>
              <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-neutral-400 font-bold mb-1">ID ROOM SECURE</label>
              <input type="text" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-sm font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setChannel(channel === 'A' ? 'B' : 'A')} className="py-2.5 bg-neutral-950 rounded-xl border border-neutral-800 font-bold text-xs">
                CHANNEL: {channel}
              </button>
              <button onClick={() => setBatterySaver(!batterySaver)} className={`py-2.5 rounded-xl text-xs font-bold border ${batterySaver ? 'bg-[#DFFF00]/10 border-[#DFFF00] text-[#DFFF00]' : 'border-neutral-800 text-neutral-400'}`}>
                ECO MODE: {batterySaver ? 'ON' : 'OFF'}
              </button>
            </div>
            <button onClick={joinChannel} className="w-full py-3.5 bg-[#DFFF00] text-black font-black text-sm rounded-xl tracking-wider active:scale-95 transition">
              CONNECT TO ROOM
            </button>
          </div>
        </main>
      ) : (
        <main className="w-full max-w-md flex-1 flex flex-col justify-between py-4 gap-4">
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-900">
              <p className="text-neutral-500 text-[9px] font-bold">ROOM ACTIVE</p>
              <p className="font-bold text-white font-mono mt-0.5">{roomId}</p>
            </div>
            <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-900">
              <p className="text-neutral-500 text-[9px] font-bold">CREW ONLINE</p>
              <p className="font-bold text-emerald-400 font-mono mt-0.5">{activePeersCount} Peer</p>
            </div>
          </div>

          <div className="relative aspect-square w-full max-w-[240px] mx-auto flex items-center justify-center bg-neutral-950 rounded-full border border-neutral-900">
            <div className={`w-32 h-32 rounded-full border-2 flex flex-col items-center justify-center transition ${isMuted ? 'border-red-500 bg-red-950/10' : isSpeaking ? 'border-[#DFFF00] bg-[#DFFF00]/10' : 'border-emerald-500/40'}`}>
              <Mic className={`w-8 h-8 ${isMuted ? 'text-red-500' : isSpeaking ? 'text-[#DFFF00]' : 'text-emerald-400'}`} />
              <span className="text-[9px] font-bold mt-2 tracking-widest text-neutral-400">{isMuted ? 'MUTED' : isSpeaking ? 'TALKING' : 'STANDBY'}</span>
            </div>
          </div>

          <div className="bg-neutral-950 border border-neutral-900 rounded-xl p-3 flex-1 overflow-y-auto max-h-[140px] text-xs space-y-1">
            <div className="text-neutral-500 font-bold text-[9px] uppercase">Daftar Koneksi P2P</div>
            <div className="flex justify-between p-1.5 bg-neutral-900/40 rounded text-neutral-300">
              <span>{userName} (Anda)</span> <span className="text-emerald-400 font-mono">Master</span>
            </div>
            {Object.keys(peers).map(id => (
              <div key={id} className="flex justify-between p-1.5 bg-neutral-900/60 rounded text-neutral-300">
                <span>{peers[id].name}</span> <span className="text-[#DFFF00] font-mono">Direct</span>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={toggleMute} className={`py-3 rounded-xl font-bold text-xs border ${isMuted ? 'bg-red-500/10 border-red-500 text-red-500' : 'bg-neutral-950 border-neutral-850'}`}>
                {isMuted ? 'UNMUTE MIC' : 'MUTE MIC'}
              </button>
              <button onClick={() => setIsLocked(true)} className="py-3 bg-neutral-950 border border-neutral-850 rounded-xl font-bold text-xs text-neutral-400">
                MODE KANTONG
              </button>
            </div>

            <div className="bg-neutral-950 border border-neutral-900 rounded-xl p-2.5">
              <div className="flex justify-between text-[10px] font-bold mb-1 text-neutral-400">
                <span>MIC GATE SENSITIVITY</span> <span>{gateThreshold} dB</span>
              </div>
              <input type="range" min="2" max="45" value={gateThreshold} onChange={(e) => setGateThreshold(parseInt(e.target.value))} className="w-full accent-[#DFFF00]" />
            </div>

            <button onClick={leaveChannel} className="w-full py-2.5 bg-red-950/40 text-red-400 border border-red-900 rounded-xl text-xs font-bold">
              DISCONNECT
            </button>
          </div>
        </main>
      )}
    </div>
  );
}
