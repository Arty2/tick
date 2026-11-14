// ── Remote control: how the screens talk ──────────────
// One kiosk holds the timer. Remote pads and read-only kiosks are its
// clients. Two transports, used together:
//   BroadcastChannel — tabs of one browser; needs no network
//   WebRTC (PeerJS)  — other devices; needs the internet to be introduced
// A message may arrive both ways; the kiosk runs each command once (by id).
//
// Both expose:  .send(msg)  .onmessage = fn(msg)  .close()

export const HEARTBEAT_MS = 2000;
// Three missed heartbeats: the other side is gone.
export const LOST_MS = 6000;

export function bcTransport(code) {
  const ch = new BroadcastChannel('tick-rc-' + code);
  const t = { onmessage: null,
    send(msg) { try { ch.postMessage(msg); } catch {} },
    close() { ch.close(); }
  };
  ch.onmessage = e => t.onmessage?.(e.data);
  return t;
}

// PeerJS ships with the app (vendor/), so the only thing asked of the network
// is the introduction. It is loaded the first time a remote session starts.
let peerLib = null;
const loadPeer = () => peerLib ??= new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = 'vendor/peerjs.min.js';
  script.onload = resolve;
  script.onerror = () => { peerLib = null; reject(new Error('PeerJS load failed')); };
  document.head.appendChild(script);
});

// The kiosk registers as "tick-CODE"; clients get an id of their own and dial
// that one. onFail gets the error's type ("unavailable-id" when another
// kiosk already holds the code).
export function peerTransport(code, isClient, onReady, onFail) {
  loadPeer().then(() => {
    const peer = new window.Peer(isClient ? undefined : 'tick-' + code, {
      config: { iceServers: [{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}] }
    });
    let conns = [];
    const t = { connected: false, onmessage: null,
      send(msg) { conns.forEach(c => { try { c.send(msg); } catch {} }); },
      close() { window.removeEventListener('online', rejoin); peer.destroy(); }
    };
    const wireConn = conn => {
      conn.on('open', () => { conns.push(conn); t.connected = true; t.onmessage?.({type:'_peerOpen'}); });
      conn.on('data', msg => { t.onmessage?.(msg); });
      conn.on('close', () => { conns = conns.filter(c => c !== conn); t.connected = conns.length > 0; });
    };
    if (isClient) {
      // A client dials the kiosk; if the kiosk is lost it dials again, which
      // reaches a kiosk that has taken over the same code.
      t.reconnect = () => { if (!conns.length && peer.open) wireConn(peer.connect('tick-' + code, {reliable:true})); };
      peer.on('open', () => t.reconnect());
    } else {
      peer.on('connection', wireConn);
    }
    peer.on('error', e => { if (!t.connected) onFail(e?.type ?? String(e)); });
    // Back online after a drop: rejoin the broker, so the other side can
    // be reached again without reloading either page.
    const rejoin = () => { if (peer.disconnected && !peer.destroyed) peer.reconnect(); };
    window.addEventListener('online', rejoin);
    peer.on('open', () => onReady(t));
  }).catch(e => onFail(String(e)));
}

// A client's link to the kiosk — a remote pad's, or a read-only kiosk's. It
// says hello (with its role and an id, so the kiosk can count who is there),
// keeps saying it is alive, and says goodbye when the page goes.
export function clientLink(code, role, onMessage, onPeerFail = () => {}) {
  const cid = Math.random().toString(36).slice(2, 10);
  const bc = bcTransport(code);
  let peer = null, closed = false;
  const link = {
    cid,
    send(msg) { bc.send(msg); peer?.send(msg); },
    reconnect() { peer?.reconnect?.(); },
    close() {
      if (closed) return; closed = true;
      link.send({type:'bye', cid});
      clearTimeout(helloTid); clearInterval(pingTid);
      window.removeEventListener('pagehide', link.close);
      window.removeEventListener('online', link.reconnect);
      bc.close(); peer?.close();
    },
  };
  const hello = () => link.send({type:'hello', role, cid});
  const receive = msg => {
    if (closed || !msg || typeof msg !== 'object') return;
    // A kiosk that has just arrived, or a WebRTC link that has just opened.
    if (msg.type === 'hostHello' || msg.type === '_peerOpen') hello();
    onMessage(msg);
  };
  bc.onmessage = receive;
  const helloTid = setTimeout(hello, 100);
  const pingTid = setInterval(() => link.send({type:'ping', role, cid}), HEARTBEAT_MS);
  peerTransport(code, true,
    t => { if (closed) { t.close(); return; } peer = t; t.onmessage = receive; },
    onPeerFail);
  window.addEventListener('pagehide', link.close);
  window.addEventListener('online', link.reconnect);
  return link;
}
