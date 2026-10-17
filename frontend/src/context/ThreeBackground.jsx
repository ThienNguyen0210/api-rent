import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// Scene layouts per route: the knot is large and to the right on the home page,
// then recedes on other pages so forms and tables stay readable.
const HOME = { x: 2.4, y: 0.2, scale: 1, z: 7, opacity: 0.9 }
const INNER = { x: 3.6, y: -0.6, scale: 0.6, z: 8, opacity: 0.45 }

export default function ThreeBackground() {
  const mount = useRef(null)
  const { pathname } = useLocation()
  const target = useRef(HOME)
  target.current = pathname === '/' ? HOME : INNER

  useEffect(() => {
    const el = mount.current
    if (!el) return
    let renderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }) } catch { return } // no WebGL: CSS gradient remains
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const small = window.innerWidth < 720

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 0, HOME.z)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    el.appendChild(renderer.domElement)

    // Reflections give the metal something to reflect
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const cyan = new THREE.PointLight(0x00f3ff, 60, 30); cyan.position.set(4, 3, 4); scene.add(cyan)
    const purple = new THREE.PointLight(0xa855f7, 50, 30); purple.position.set(-4, -3, 3); scene.add(purple)

    // Hero object
    const knotGeo = new THREE.TorusKnotGeometry(1.8, 0.55, 160, 32, 2, 3)
    const knotMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a192f, metalness: 0.92, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.1,
      iridescence: 0.9, iridescenceIOR: 1.3, envMapIntensity: 0.7, transparent: true,
    })
    const knot = new THREE.Mesh(knotGeo, knotMat)
    scene.add(knot)

    // Wireframe shell orbiting the knot
    const shellGeo = new THREE.IcosahedronGeometry(3.3, 1)
    const shellMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff, wireframe: true, transparent: true, opacity: 0.08 })
    const shell = new THREE.Mesh(shellGeo, shellMat)
    scene.add(shell)

    // Thin rings for depth
    const ringGeo = new THREE.TorusGeometry(4.2, 0.008, 8, 200)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.35 })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2.4
    scene.add(ring)

    // Particle field
    const count = small ? 90 : 220
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < pos.length; i++) pos[i] = (Math.random() - 0.5) * 18
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const dustMat = new THREE.PointsMaterial({ size: 0.035, color: 0x00f3ff, transparent: true, opacity: 0.7, depthWrite: false })
    const dust = new THREE.Points(dustGeo, dustMat)
    scene.add(dust)

    const group = [knot, shell, ring]
    const cur = { ...HOME }
    let mx = 0, my = 0, tx = 0, ty = 0, scroll = 0

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
      const t = reduced ? 0 : clock.getElapsedTime()
      const g = target.current
      for (const k of ['x', 'y', 'scale', 'z', 'opacity']) cur[k] += (g[k] - cur[k]) * 0.05
      // On narrow screens centre the knot behind the content, dimmed
      const shift = small ? 0 : 1
      tx += (mx - tx) * 0.05; ty += (my - ty) * 0.05

      const pulse = 1 + Math.sin(t * 1.5) * 0.03
      knot.scale.setScalar(cur.scale * pulse)
      shell.scale.setScalar(cur.scale)
      ring.scale.setScalar(cur.scale)
      for (const o of group) o.position.set(cur.x * shift, cur.y + scroll * 1.2, 0)
      knot.rotation.set(Math.PI / 4 + ty * 0.4 + scroll * 0.6, t * 0.35 + tx * 0.4, 0)
      shell.rotation.set(t * 0.08, -t * 0.12, 0)
      ring.rotation.z = t * 0.15
      dust.rotation.y = t * 0.05 + tx * 0.1
      dust.position.y = scroll * 0.8
      camera.position.z = cur.z
      knotMat.opacity = small ? cur.opacity * 0.6 : cur.opacity
      renderer.render(scene, camera)
    }
    frame()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll)
      ;[knotGeo, shellGeo, ringGeo, dustGeo, knotMat, shellMat, ringMat, dustMat, envTex].forEach(d => d.dispose())
      pmrem.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={mount} className="mk-canvas" aria-hidden="true" />
}
