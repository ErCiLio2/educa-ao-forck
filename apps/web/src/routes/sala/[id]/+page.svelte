<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { io, type Socket } from 'socket.io-client';
  import { Room, RoomEvent, Track, type RemoteTrackPublication, type RemoteParticipant } from 'livekit-client';
  import Icon from '@iconify/svelte';
  import { PUBLIC_API_URL } from '$env/static/public';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // ── UI ────────────────────────────────────────────────────────────────────────
  type Tab = 'whiteboard' | 'video';
  let activeTab = $state<Tab>('whiteboard');
  let isConnected = $state(false);

  // ── Socket.IO ─────────────────────────────────────────────────────────────────
  let socket: Socket | null = null;

  // ── Participantes ─────────────────────────────────────────────────────────────
  type Participant = { userId: string; userName: string; role: string };
  let participants = $state<Participant[]>([]);

  // ── Chat ──────────────────────────────────────────────────────────────────────
  type ChatMsg = { id: string; userId: string; userName: string; text: string; sentAt: string };
  let messages = $state<ChatMsg[]>([]);
  let messagesEl: HTMLDivElement | undefined;
  let chatInput = $state('');
  let isTypingOut = false;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;
  let remoteTyper = $state<string | null>(null);
  let remoteTyperTimer: ReturnType<typeof setTimeout> | null = null;

  function scrollChat() {
    setTimeout(() => messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }), 30);
  }

  function sendMessage() {
    const text = chatInput.trim();
    if (!text || !socket || !isConnected) return;
    socket.emit('chat:message', { sessionId: data.session.id, text }, (res: { ok?: boolean }) => {
      if (res?.ok) chatInput = '';
    });
  }

  function onChatKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function onChatInput() {
    if (!socket || !isConnected) return;
    if (!isTypingOut) {
      isTypingOut = true;
      socket.emit('chat:typing', { sessionId: data.session.id, typing: true });
    }
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      isTypingOut = false;
      socket!.emit('chat:typing', { sessionId: data.session.id, typing: false });
    }, 1500);
  }

  // ── Whiteboard ────────────────────────────────────────────────────────────────
  let canvas: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let drawing = false;
  let pts: { x: number; y: number }[] = [];
  let color = $state('#171717');
  let width = $state(2);
  const COLORS = ['#171717', '#e5383b', '#ffe600', '#2563eb', '#16a34a', '#ffffff'];

  function resizeCanvas() {
    if (!canvas) return;
    const { width: w, height: h } = canvas.parentElement!.getBoundingClientRect();
    canvas.width = w;
    canvas.height = h;
  }

  function pos(e: PointerEvent) {
    const r = canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function strokeLine(points: { x: number; y: number }[], c: string, w: number) {
    if (!ctx || points.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

  function onDown(e: PointerEvent) {
    canvas!.setPointerCapture(e.pointerId);
    drawing = true; pts = [pos(e)];
  }

  function onMove(e: PointerEvent) {
    if (!drawing) return;
    pts.push(pos(e));
    strokeLine(pts.slice(-2), color, width);
  }

  function onUp() {
    if (!drawing) return;
    drawing = false;
    if (pts.length >= 2 && socket && isConnected) {
      socket.emit('wb:stroke', { sessionId: data.session.id, points: pts, color, width });
    }
    pts = [];
  }

  function clearCanvas(emit = true) {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (emit && socket && isConnected) socket.emit('wb:clear', { sessionId: data.session.id });
  }

  // ── LiveKit ───────────────────────────────────────────────────────────────────
  let room: Room | null = null;
  let micOn = $state(false);
  let camOn = $state(false);
  let livekitError = $state('');
  let localVideoEl = $state<HTMLVideoElement | undefined>(undefined);

  type VideoTrack = { sid: string; name: string; el?: HTMLVideoElement };
  let videoTracks = $state<VideoTrack[]>([]);

  function remoteVideoAction(el: HTMLVideoElement, sid: string) {
    bindRemoteVideo(el, sid);
  }

  function bindRemoteVideo(el: HTMLVideoElement, sid: string) {
    if (!room) return;
    for (const [, p] of room.remoteParticipants) {
      for (const [, pub] of p.trackPublications) {
        if (pub.trackSid === sid && pub.track && pub.kind === Track.Kind.Video) {
          pub.track.attach(el);
          return;
        }
      }
    }
  }

  $effect(() => {
    if (camOn && localVideoEl && room) {
      room.localParticipant.setCameraEnabled(true).then(() => {
        const pub = room!.localParticipant.getTrackPublication(Track.Source.Camera);
        if (pub?.track && localVideoEl) pub.track.attach(localVideoEl);
      });
    }
  });

  async function toggleMic() {
    if (!room) return;
    micOn = !micOn;
    await room.localParticipant.setMicrophoneEnabled(micOn);
  }

  async function toggleCam() {
    if (!room) return;
    if (camOn) {
      await room.localParticipant.setCameraEnabled(false);
      camOn = false;
    } else {
      camOn = true;
    }
  }

  async function connectLiveKit() {
    room = new Room();
    room.on(RoomEvent.TrackSubscribed, (_t, pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (pub.kind === Track.Kind.Video) {
        videoTracks = [...videoTracks, { sid: pub.trackSid, name: p.name ?? p.identity }];
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (_t, pub: RemoteTrackPublication) => {
      videoTracks = videoTracks.filter((t) => t.sid !== pub.trackSid);
    });
    try {
      await room.connect(data.livekit.url, data.livekit.token);
    } catch {
      livekitError = 'Não foi possível ligar ao servidor de vídeo.';
    }
  }

  function leaveSession() {
    socket?.emit('session:leave', { sessionId: data.session.id });
    socket?.disconnect();
    room?.disconnect();
    history.back();
  }

  // ── Ciclo de vida ─────────────────────────────────────────────────────────────
  onMount(() => {
    if (canvas) { ctx = canvas.getContext('2d'); resizeCanvas(); }
    window.addEventListener('resize', resizeCanvas);

    socket = io(PUBLIC_API_URL, { auth: { token: data.token }, transports: ['websocket'] });

    socket.on('connect', () => {
      isConnected = true;
      socket!.emit('session:join', { sessionId: data.session.id });
    });
    socket.on('disconnect', () => { isConnected = false; });

    socket.on('session:participant_joined', (p: Participant) => {
      if (!participants.find((x) => x.userId === p.userId)) participants = [...participants, p];
    });
    socket.on('session:participant_left', ({ userId }: { userId: string }) => {
      participants = participants.filter((p) => p.userId !== userId);
    });

    socket.on('chat:message', (msg: ChatMsg) => {
      messages = [...messages, msg];
      scrollChat();
    });
    socket.on('chat:typing', ({ userId, userName, typing }: { userId: string; userName: string; typing: boolean }) => {
      if (userId === data.user.id) return;
      if (typing) {
        remoteTyper = userName;
        if (remoteTyperTimer) clearTimeout(remoteTyperTimer);
        remoteTyperTimer = setTimeout(() => { remoteTyper = null; }, 3000);
      } else {
        remoteTyper = null;
      }
    });

    socket.on('wb:stroke', ({ userId: uid, points, color: c, width: w }: { userId: string; points: {x:number;y:number}[]; color: string; width: number }) => {
      if (uid !== data.user.id) strokeLine(points, c, w);
    });
    socket.on('wb:clear', () => clearCanvas(false));

    participants = [{ userId: data.user.id, userName: data.user.name, role: 'me' }];

    connectLiveKit();
  });

  onDestroy(() => {
    if (!browser) return;
    socket?.emit('session:leave', { sessionId: data.session.id });
    socket?.disconnect();
    room?.disconnect();
    window.removeEventListener('resize', resizeCanvas);
    if (typingTimer) clearTimeout(typingTimer);
    if (remoteTyperTimer) clearTimeout(remoteTyperTimer);
  });
</script>

<svelte:head><title>{data.session.title} — eDuca</title></svelte:head>

<div class="flex flex-col h-screen bg-background overflow-hidden">
  <!-- Barra superior -->
  <header class="h-14 flex items-center justify-between px-4 border-b border-border bg-surface shrink-0">
    <div class="flex items-center gap-3">
      <button onclick={() => history.back()} class="text-muted-foreground hover:text-foreground">
        <Icon icon="solar:arrow-left-linear" width="20" />
      </button>
      <div>
        <p class="text-sm font-semibold text-foreground leading-tight">{data.session.title}</p>
        <p class="text-xs text-muted-foreground">{data.session.subject}</p>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex items-center gap-1 bg-muted p-1 rounded-lg">
      {#each (['whiteboard', 'video'] as const) as tab}
        <button
          onclick={() => activeTab = tab}
          class={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === tab ? 'bg-foreground text-white' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Icon icon={tab === 'whiteboard' ? 'solar:pen-new-square-linear' : 'solar:video-library-linear'} width="14" />
          {tab === 'whiteboard' ? 'Quadro' : 'Vídeo'}
        </button>
      {/each}
    </div>

    <div class="flex items-center gap-2">
      <span class={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-destructive'}`}></span>
      <span class="text-xs text-muted-foreground">{isConnected ? 'Ligado' : 'A ligar…'}</span>
    </div>
  </header>

  <div class="flex flex-1 overflow-hidden">
    <!-- Área central -->
    <main class="flex-1 overflow-hidden relative">

      <!-- Whiteboard -->
      <div class={activeTab === 'whiteboard' ? 'block h-full' : 'hidden'}>
        <!-- Ferramentas -->
        <div class="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-surface border border-border rounded-xl px-3 py-2 shadow-sm">
          {#each COLORS as c}
            <button
              onclick={() => color = c}
              aria-label={`Cor ${c}`}
              class={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'scale-125 border-foreground' : 'border-transparent'}`}
              style={`background:${c};${c === '#ffffff' ? 'border-color:#d4d4d4' : ''}`}
            ></button>
          {/each}
          <div class="w-px h-5 bg-border mx-1"></div>
          {#each [2, 5, 10] as w}
            <button
              onclick={() => width = w}
              aria-label={`Espessura ${w}`}
              class={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${width === w ? 'bg-foreground text-white' : 'hover:bg-muted text-muted-foreground'}`}
            >
              <span class="rounded-full bg-current" style={`width:${w}px;height:${w}px`}></span>
            </button>
          {/each}
          <div class="w-px h-5 bg-border mx-1"></div>
          <button
            onclick={() => clearCanvas()}
            class="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Icon icon="solar:trash-bin-minimalistic-linear" width="14" />
            Limpar
          </button>
        </div>

        <canvas
          bind:this={canvas}
          class="w-full h-full cursor-crosshair touch-none"
          style="background:#fafafa"
          onpointerdown={onDown}
          onpointermove={onMove}
          onpointerup={onUp}
          onpointerleave={onUp}
        ></canvas>
      </div>

      <!-- Vídeo -->
      <div class={`${activeTab === 'video' ? 'flex' : 'hidden'} flex-col h-full bg-[#0f0f0f] p-4 gap-4`}>
        {#if livekitError}
          <div class="flex-1 flex items-center justify-center">
            <div class="text-center">
              <Icon icon="solar:video-library-linear" width="48" class="text-white/20 mx-auto mb-3" />
              <p class="text-white/40 text-sm">{livekitError}</p>
            </div>
          </div>
        {:else}
          <div class="flex-1 grid grid-cols-2 gap-3 overflow-hidden">
            <!-- Local -->
            <div class="relative bg-[#1a1a1a] rounded-xl overflow-hidden flex items-center justify-center">
              {#if camOn}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video bind:this={localVideoEl} class="w-full h-full object-cover" autoplay muted playsinline></video>
              {:else}
                <div class="flex flex-col items-center gap-2">
                  <div class="w-16 h-16 rounded-full bg-foreground/20 flex items-center justify-center">
                    <Icon icon="solar:user-rounded-linear" width="32" class="text-white/60" />
                  </div>
                  <span class="text-white/40 text-xs">{data.user.name}</span>
                </div>
              {/if}
              <span class="absolute bottom-2 left-2 text-[11px] text-white/80 bg-black/50 px-2 py-0.5 rounded-full">
                {data.user.name} (eu)
              </span>
            </div>

            <!-- Remotos -->
            {#each videoTracks as track (track.sid)}
              <div class="relative bg-[#1a1a1a] rounded-xl overflow-hidden">
                <!-- svelte-ignore a11y_media_has_caption -->
                <video
                  class="w-full h-full object-cover"
                  autoplay
                  playsinline
                  use:remoteVideoAction={track.sid}
                ></video>
                <span class="absolute bottom-2 left-2 text-[11px] text-white/80 bg-black/50 px-2 py-0.5 rounded-full">
                  {track.name}
                </span>
              </div>
            {/each}
          </div>

          <!-- Controlos -->
          <div class="flex items-center justify-center gap-3 pb-2">
            <button
              onclick={toggleMic}
              class={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${micOn ? 'bg-foreground text-white' : 'bg-[#2a2a2a] text-white/60 hover:bg-[#3a3a3a]'}`}
            >
              <Icon icon={micOn ? 'solar:microphone-bold' : 'solar:microphone-slash-bold'} width="20" />
            </button>
            <button
              onclick={toggleCam}
              class={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${camOn ? 'bg-foreground text-white' : 'bg-[#2a2a2a] text-white/60 hover:bg-[#3a3a3a]'}`}
            >
              <Icon icon={camOn ? 'solar:videocamera-bold' : 'solar:videocamera-slash-bold'} width="20" />
            </button>
            <button
              onclick={leaveSession}
              class="w-12 h-12 rounded-full bg-destructive text-white flex items-center justify-center hover:bg-destructive/80 transition-colors"
            >
              <Icon icon="solar:end-call-bold" width="20" />
            </button>
          </div>
        {/if}
      </div>
    </main>

    <!-- Painel lateral -->
    <aside class="w-80 flex flex-col border-l border-border bg-surface">
      <!-- Participantes -->
      <div class="p-3 border-b border-border">
        <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Participantes ({participants.length})
        </p>
        <div class="space-y-1.5 max-h-28 overflow-y-auto">
          {#each participants as p (p.userId)}
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded-full bg-foreground flex items-center justify-center text-[10px] text-white font-bold shrink-0">
                {p.userName?.[0]?.toUpperCase() ?? '?'}
              </div>
              <span class="text-xs text-foreground truncate">{p.userName}</span>
              {#if p.role === 'tutor'}
                <span class="ml-auto text-[10px] text-muted-foreground">Tutor</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <!-- Mensagens -->
      <div bind:this={messagesEl} class="flex-1 overflow-y-auto p-3 space-y-3">
        {#if messages.length === 0}
          <div class="text-center py-8">
            <Icon icon="solar:chat-line-linear" width="32" class="text-muted-foreground/20 mx-auto mb-2" />
            <p class="text-xs text-muted-foreground/50">Sem mensagens ainda</p>
          </div>
        {/if}
        {#each messages as msg (msg.id)}
          {@const isMe = msg.userId === data.user.id}
          <div class={`flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
            {#if !isMe}
              <span class="text-[10px] text-muted-foreground px-1">{msg.userName}</span>
            {/if}
            <div class={`max-w-[85%] px-3 py-2 rounded-2xl text-sm ${isMe ? 'bg-foreground text-white rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm'}`}>
              {msg.text}
            </div>
            <span class="text-[9px] text-muted-foreground/50 px-1">
              {new Date(msg.sentAt).toLocaleTimeString('pt-AO', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        {/each}
        {#if remoteTyper}
          <p class="text-[10px] text-muted-foreground italic px-1">{remoteTyper} está a escrever…</p>
        {/if}
      </div>

      <!-- Input de chat -->
      <div class="p-3 border-t border-border">
        <div class="flex items-end gap-2">
          <textarea
            bind:value={chatInput}
            onkeydown={onChatKeydown}
            oninput={onChatInput}
            placeholder="Mensagem…"
            rows="1"
            disabled={!isConnected}
            class="flex-1 resize-none bg-muted rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-40 max-h-24"
          ></textarea>
          <button
            onclick={sendMessage}
            disabled={!chatInput.trim() || !isConnected}
            class="w-9 h-9 bg-foreground text-white rounded-xl flex items-center justify-center hover:bg-foreground/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Icon icon="solar:plain-2-bold" width="16" />
          </button>
        </div>
      </div>
    </aside>
  </div>
</div>
