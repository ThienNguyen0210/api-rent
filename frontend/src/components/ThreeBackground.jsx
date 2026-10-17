import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import * as THREE from 'three'

// Cấu hình vị trí mạng nơ-ron theo từng route: hiển thị lớn và nổi bật ở trang chủ,
// sau đó thu nhỏ và dịch chuyển nhẹ ở các trang trong để không làm ảnh hưởng nội dung.
const HOME = { x: 2.6, y: 0, scale: 1, z: 9, opacity: 1 }
const INNER = { x: 3.4, y: -0.4, scale: 0.7, z: 10, opacity: 0.4 }
const LAYERS = [4, 6, 7, 6, 3]

const C_INPUT = new THREE.Color(0x00f3ff) // Xanh ngọc điện tử đặc trưng của Nexora
const C_OUTPUT = new THREE.Color(0x8b5cf6) // Tím AI cao cấp
const C_HOT = new THREE.Color(0xffffff)

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

export default function ThreeBackground() {
  const mount = useRef(null)
  const { pathname } = useLocation()
  const target = useRef(HOME)
  target.current = pathname === '/' ? HOME : INNER

  useEffect(() => {
    const el = mount.current
    if (!el) return
    let renderer
    try { 
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }) 
    } catch { 
      return 
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const small = window.innerWidth < 720

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, HOME.z)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2))
    el.appendChild(renderer.domElement)

    const glow = glowTexture()
    const net = new THREE.Group()
    scene.add(net)

    // ---- Các nút mạng nơ-ron phân theo các layer ----
    const nodes = [] 
    const layerStart = []
    LAYERS.forEach((n, li) => {
      layerStart.push(nodes.length)
      const x = (li / (LAYERS.length - 1) - 0.5 * 1.1) * 8.5
      for (let i = 0; i < n; i++) {
        const y = (n === 1 ? 0 : (i / (n - 1) - 0.5) * 5.5) + (Math.random() - 0.5) * 0.3
        const z = (Math.random() - 0.5) * 2.8
        nodes.push({ p: new THREE.Vector3(x, y, z), layer: li })
      }
    })

    // ---- Các kết nối giữa các layer lân cận ----
    const edges = [] 
    const outgoing = nodes.map(() => [])
    for (let li = 0; li < LAYERS.length - 1; li++) {
      for (let a = layerStart[li]; a < layerStart[li] + LAYERS[li]; a++) {
        for (let b = layerStart[li + 1]; b < layerStart[li + 1] + LAYERS[li + 1]; b++) {
          outgoing[a].push(edges.length)
          edges.push({ a, b })
        }
      }
    }
    const layerColor = li => C_INPUT.clone().lerp(C_OUTPUT, li / (LAYERS.length - 1))

    const edgePos = new Float32Array(edges.length * 6)
    const edgeCol = new Float32Array(edges.length * 6)
    edges.forEach((e, i) => {
      const pa = nodes[e.a].p, pb = nodes[e.b].p
      edgePos.set([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z], i * 6)
      const ca = layerColor(nodes[e.a].layer), cb = layerColor(nodes[e.b].layer)
      edgeCol.set([ca.r * 1.2, ca.g * 1.2, ca.b * 1.2, cb.r * 1.2, cb.g * 1.2, cb.b * 1.2], i * 6)
    })
    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3))
    edgeGeo.setAttribute('color', new THREE.BufferAttribute(edgeCol, 3))
    const EDGE_OPACITY = 0.38
    const edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: EDGE_OPACITY,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    net.add(new THREE.LineSegments(edgeGeo, edgeMat))

    // ---- Hiệu ứng sáng cho các nút nơ-ron ----
    const nodePos = new Float32Array(nodes.length * 3)
    nodes.forEach((n, i) => nodePos.set([n.p.x, n.p.y, n.p.z], i * 3))
    const nodeCol = new Float32Array(nodes.length * 3)
    const energy = new Float32Array(nodes.length)
    const nodeGeo = new THREE.BufferGeometry()
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3))
    const nodeColAttr = new THREE.BufferAttribute(nodeCol, 3)
    nodeGeo.setAttribute('color', nodeColAttr)
    
    const haloMat = new THREE.PointsMaterial({
      size: 0.95, map: glow, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const coreMat = new THREE.PointsMaterial({
      size: 0.18, map: glow, color: 0xffffff, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    net.add(new THREE.Points(nodeGeo, haloMat), new THREE.Points(nodeGeo, coreMat))

    // ---- Tín hiệu dữ liệu (Signals) chạy dọc đường kết nối ----
    const PULSES = small ? 25 : 55
    const pulses = Array.from({ length: PULSES }, () => ({
      e: Math.floor(Math.random() * edges.length),
      t: Math.random(),
      s: 0.3 + Math.random() * 0.4,
    }))
    const pulsePos = new Float32Array(PULSES * 3)
    const pulseGeo = new THREE.BufferGeometry()
    const pulseAttr = new THREE.BufferAttribute(pulsePos, 3)
    pulseGeo.setAttribute('position', pulseAttr)
    const pulseMat = new THREE.PointsMaterial({
      size: 0.4, map: glow, color: 0x00f3ff, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    net.add(new THREE.Points(pulseGeo, pulseMat))

    const placePulses = () => {
      pulses.forEach((p, i) => {
        const { a, b } = edges[p.e]
        pulsePos.set([
          nodes[a].p.x + (nodes[b].p.x - nodes[a].p.x) * p.t,
          nodes[a].p.y + (nodes[b].p.y - nodes[a].p.y) * p.t,
          nodes[a].p.z + (nodes[b].p.z - nodes[a].p.z) * p.t,
        ], i * 3)
      })
      pulseAttr.needsUpdate = true
    }
    const paintNodes = () => {
      nodes.forEach((n, i) => {
        const c = layerColor(n.layer).lerp(C_HOT, Math.min(energy[i], 1))
        const k = 0.6 + energy[i] * 1.1
        nodeCol.set([c.r * k, c.g * k, c.b * k], i * 3)
      })
      nodeColAttr.needsUpdate = true
    }
    placePulses()
    paintNodes()

    // ---- Hiệu ứng hạt bụi không gian (Dust) ----
    const dustCount = small ? 90 : 200
    const dustPos = new Float32Array(dustCount * 3)
    for (let i = 0; i < dustPos.length; i++) dustPos[i] = (Math.random() - 0.5) * 24
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
    const dustMat = new THREE.PointsMaterial({
      size: 0.055, color: 0x00f3ff, transparent: true, opacity: 0.45, depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const dust = new THREE.Points(dustGeo, dustMat)
    scene.add(dust)

    const cur = { ...HOME }
    let mx = 0, my = 0, tx = 0, ty = 0, scroll = 0, time = 0

    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const onMove = e => { mx = (e.clientX / window.innerWidth) * 2 - 1; my = -(e.clientY / window.innerHeight) * 2 + 1 }
    const onScroll = () => { scroll = window.scrollY / window.innerHeight }
    
    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })

    const clock = new THREE.Clock()
    let raf
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(clock.getDelta(), 0.05)
      if (!reduced) time += dt
      const g = target.current
      for (const k of ['x', 'y', 'scale', 'z', 'opacity']) cur[k] += (g[k] - cur[k]) * 0.05
      const shift = small ? 0 : 1
      tx += (mx - tx) * 0.05; ty += (my - ty) * 0.05

      if (!reduced) {
        for (const p of pulses) {
          p.t += p.s * dt
          if (p.t >= 1) {
            const arrived = edges[p.e].b
            energy[arrived] = 1.2
            const next = outgoing[arrived]
            p.e = next.length ? next[Math.floor(Math.random() * next.length)] : Math.floor(Math.random() * outgoing[0].length)
            p.t = 0
          }
        }
        for (let i = 0; i < energy.length; i++) energy[i] *= Math.pow(0.05, dt)
        placePulses()
        paintNodes()
      }

      net.position.set(cur.x * shift, cur.y + scroll * 1.3, 0)
      net.scale.setScalar(cur.scale)
      net.rotation.y = -0.2 + Math.sin(time * 0.2) * 0.25 + tx * 0.3
      net.rotation.x = ty * 0.12 + Math.sin(time * 0.18) * 0.04
      dust.rotation.y = time * 0.035 + tx * 0.07
      dust.position.y = scroll * 0.85
      camera.position.z = cur.z

      const o = small ? cur.opacity * 0.65 : cur.opacity
      edgeMat.opacity = EDGE_OPACITY * o
      haloMat.opacity = o
      coreMat.opacity = o
      pulseMat.opacity = o
      renderer.render(scene, camera)
    }
    frame()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll)
      ;[edgeGeo, nodeGeo, pulseGeo, dustGeo, edgeMat, haloMat, coreMat, pulseMat, dustMat, glow].forEach(d => d?.dispose())
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={mount} className="mk-canvas" />
}