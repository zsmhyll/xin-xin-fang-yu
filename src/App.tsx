/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Target, Trophy, AlertTriangle, RefreshCw, Globe } from 'lucide-react';
import { 
  GAME_WIDTH, 
  GAME_HEIGHT, 
  ROCKET_SPEED_BASE, 
  PLAYER_MISSILE_SPEED, 
  EXPLOSION_MAX_RADIUS, 
  EXPLOSION_GROWTH_SPEED, 
  EXPLOSION_DECAY_SPEED, 
  SCORE_PER_ROCKET, 
  WIN_SCORE,
  BATTERY_CONFIGS,
  CITY_COUNT
} from './constants';
import { 
  GameState, 
  Rocket, 
  PlayerMissile, 
  Explosion, 
  City, 
  Battery, 
  Point 
} from './types';

const INITIAL_STATE: GameState = {
  score: 0,
  status: 'START',
  cities: Array.from({ length: CITY_COUNT }, (_, i) => ({
    id: `city-${i}`,
    pos: { x: 120 + i * 110 + (i > 2 ? 40 : 0), y: GAME_HEIGHT - 20 },
    isDestroyed: false,
  })),
  batteries: BATTERY_CONFIGS.map((config, i) => ({
    id: `battery-${i}`,
    pos: { x: config.x, y: GAME_HEIGHT - 30 },
    missiles: config.maxMissiles,
    maxMissiles: config.maxMissiles,
    isDestroyed: false,
  })),
  rockets: [],
  playerMissiles: [],
  explosions: [],
  level: 50,
};

export default function App() {
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const lastTimeRef = useRef<number>(0);

  const t = {
    zh: {
      title: "Tina新星防御",
      start: "开始游戏",
      score: "得分",
      win: "任务成功！",
      levelComplete: "关卡完成！",
      nextLevel: "下一关",
      lose: "任务失败",
      restart: "再玩一次",
      description: "保护城市免受敌方导弹袭击。左键发射拦截导弹，右键发射引力弹。",
      missiles: "导弹",
      targetScore: "目标分数",
      currentLevel: "当前关卡",
    },
    en: {
      title: "Tina Nova Defense",
      start: "Start Game",
      score: "Score",
      win: "Mission Success!",
      levelComplete: "Level Complete!",
      nextLevel: "Next Level",
      lose: "Mission Failed",
      restart: "Play Again",
      description: "Protect cities from enemy missiles. Left-click for interceptors, right-click for gravity bombs.",
      missiles: "Missiles",
      targetScore: "Target Score",
      currentLevel: "Level",
    }
  }[lang];

  const spawnRocket = useCallback(() => {
    const start: Point = { x: Math.random() * GAME_WIDTH, y: 0 };
    // Target either a city or a battery
    const targets = [...gameState.cities.filter(c => !c.isDestroyed), ...gameState.batteries.filter(b => !b.isDestroyed)];
    if (targets.length === 0) return null;
    
    const targetEntity = targets[Math.floor(Math.random() * targets.length)];
    const target: Point = { ...targetEntity.pos };

    return {
      id: `rocket-${Math.random()}`,
      start,
      target,
      pos: { ...start },
      progress: 0,
      speed: ROCKET_SPEED_BASE + Math.random() * 0.0005 + (gameState.level * 0.0002),
    };
  }, [gameState.cities, gameState.batteries, gameState.level]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>, isGravity: boolean = false) => {
    if (gameState.status !== 'PLAYING') return;
    if ('button' in e && e.button === 2 && !isGravity) return; // Ignore right click in normal click handler

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = (clientX - rect.left) * (GAME_WIDTH / rect.width);
    const y = (clientY - rect.top) * (GAME_HEIGHT / rect.height);

    // Find closest battery with missiles
    let bestBatteryIndex = -1;
    let minDist = Infinity;
    const ammoCost = isGravity ? 3 : 1;

    gameState.batteries.forEach((b, i) => {
      if (!b.isDestroyed) {
        const dist = Math.abs(b.pos.x - x);
        if (dist < minDist) {
          minDist = dist;
          bestBatteryIndex = i;
        }
      }
    });

    if (bestBatteryIndex !== -1) {
      const battery = gameState.batteries[bestBatteryIndex];
      const isTripleShot = !isGravity;
      
      const newMissiles: PlayerMissile[] = [];
      
      if (isTripleShot) {
        // Triple shot spread
        const offsets = [-25, 0, 25];
        offsets.forEach(offsetX => {
          newMissiles.push({
            id: `missile-${Math.random()}`,
            start: { ...battery.pos },
            target: { x: x + offsetX, y: y },
            pos: { ...battery.pos },
            progress: 0,
            speed: PLAYER_MISSILE_SPEED,
            originBatteryIndex: bestBatteryIndex,
            isGravityBomb: false,
          });
        });
      } else {
        newMissiles.push({
          id: `missile-${Math.random()}`,
          start: { ...battery.pos },
          target: { x, y },
          pos: { ...battery.pos },
          progress: 0,
          speed: PLAYER_MISSILE_SPEED,
          originBatteryIndex: bestBatteryIndex,
          isGravityBomb: isGravity,
        });
      }

      setGameState(prev => ({
        ...prev,
        playerMissiles: [...prev.playerMissiles, ...newMissiles],
      }));
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    handleCanvasClick(e, true);
  };

  const triggerMegaExplosion = useCallback(() => {
    if (gameState.status !== 'PLAYING') return;

    setGameState(prev => {
      const clearedRocketsCount = prev.rockets.length;
      const newExplosions: Explosion[] = [];
      
      // Create a grid of explosions to cover the screen
      for (let x = 100; x < GAME_WIDTH; x += 200) {
        for (let y = 100; y < GAME_HEIGHT; y += 200) {
          newExplosions.push({
            id: `mega-exp-${Math.random()}`,
            pos: { x, y },
            radius: 0,
            maxRadius: 300,
            life: 1,
            isExpanding: true,
          });
        }
      }

      return {
        ...prev,
        score: prev.score + (clearedRocketsCount * SCORE_PER_ROCKET),
        rockets: [],
        explosions: [...prev.explosions, ...newExplosions],
      };
    });
  }, [gameState.status]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        triggerMegaExplosion();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerMegaExplosion]);

  const update = useCallback((time: number) => {
    if (gameState.status !== 'PLAYING') return;

    setGameState(prev => {
      const nextRockets = [...prev.rockets];
      const nextPlayerMissiles = [...prev.playerMissiles];
      const nextExplosions = [...prev.explosions];
      const nextCities = [...prev.cities];
      const nextBatteries = [...prev.batteries];
      let nextScore = prev.score;

      // 1. Spawn rockets
      if (Math.random() < 0.015 + (prev.level * 0.003)) {
        const r = spawnRocket();
        if (r) nextRockets.push(r);
      }

      // 2. Update Rockets
      for (let i = nextRockets.length - 1; i >= 0; i--) {
        const r = nextRockets[i];
        r.progress += r.speed;
        r.pos.x = r.start.x + (r.target.x - r.start.x) * r.progress;
        r.pos.y = r.start.y + (r.target.y - r.start.y) * r.progress;

        // Check if hit target
        if (r.progress >= 1) {
          // Check what it hit
          nextCities.forEach(c => {
            if (!c.isDestroyed && Math.abs(c.pos.x - r.target.x) < 20) c.isDestroyed = true;
          });
          nextBatteries.forEach(b => {
            if (!b.isDestroyed && Math.abs(b.pos.x - r.target.x) < 20) b.isDestroyed = true;
          });
          nextRockets.splice(i, 1);
          nextExplosions.push({
            id: `exp-hit-${Math.random()}`,
            pos: { ...r.target },
            radius: 0,
            maxRadius: EXPLOSION_MAX_RADIUS,
            life: 1,
            isExpanding: true,
          });
        }
      }

      // 3. Update Player Missiles
      for (let i = nextPlayerMissiles.length - 1; i >= 0; i--) {
        const m = nextPlayerMissiles[i];
        m.progress += m.speed;
        m.pos.x = m.start.x + (m.target.x - m.start.x) * m.progress;
        m.pos.y = m.start.y + (m.target.y - m.start.y) * m.progress;

        if (m.progress >= 1) {
          nextExplosions.push({
            id: `exp-p-${Math.random()}`,
            pos: { ...m.target },
            radius: 0,
            maxRadius: m.isGravityBomb ? EXPLOSION_MAX_RADIUS * 2 : EXPLOSION_MAX_RADIUS,
            life: 1,
            isExpanding: true,
          });
          nextPlayerMissiles.splice(i, 1);
        }
      }

      // 4. Update Explosions
      for (let i = nextExplosions.length - 1; i >= 0; i--) {
        const e = nextExplosions[i];
        // Gravity effect if it's a large explosion (from gravity bomb)
        const isGravity = e.maxRadius > EXPLOSION_MAX_RADIUS;

        if (e.isExpanding) {
          e.radius += EXPLOSION_GROWTH_SPEED * e.maxRadius;
          if (e.radius >= e.maxRadius) e.isExpanding = false;
        } else {
          e.radius -= EXPLOSION_DECAY_SPEED * e.maxRadius;
          if (e.radius <= 0) {
            nextExplosions.splice(i, 1);
            continue;
          }
        }

        // Check if explosion hits rockets
        for (let j = nextRockets.length - 1; j >= 0; j--) {
          const r = nextRockets[j];
          const dx = r.pos.x - e.pos.x;
          const dy = r.pos.y - e.pos.y;
          const dist = Math.sqrt(dx ** 2 + dy ** 2);

          if (isGravity && dist < e.radius * 2) {
            // Pull effect
            const force = (e.radius * 2 - dist) / (e.radius * 2) * 2;
            r.pos.x -= (dx / dist) * force;
            r.pos.y -= (dy / dist) * force;
          }

          if (dist < e.radius) {
            nextRockets.splice(j, 1);
            nextScore += SCORE_PER_ROCKET;
            nextExplosions.push({
              id: `exp-r-${Math.random()}`,
              pos: { ...r.pos },
              radius: 0,
              maxRadius: EXPLOSION_MAX_RADIUS * 0.8,
              life: 1,
              isExpanding: true,
            });
          }
        }
      }

      // Win/Loss conditions
      let nextStatus = prev.status;
      const targetScore = prev.level * WIN_SCORE;
      if (nextScore >= targetScore) {
        nextStatus = 'WON';
      } else if (nextBatteries.every(b => b.isDestroyed)) {
        nextStatus = 'LOST';
      }

      return {
        ...prev,
        score: nextScore,
        status: nextStatus,
        rockets: nextRockets,
        playerMissiles: nextPlayerMissiles,
        explosions: nextExplosions,
        cities: nextCities,
        batteries: nextBatteries,
      };
    });

    requestRef.current = requestAnimationFrame(update);
  }, [gameState.status, spawnRocket]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(update);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [update]);

  // Canvas Rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Draw Ground
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, GAME_HEIGHT - 10, GAME_WIDTH, 10);

    // Draw Cities
    gameState.cities.forEach(city => {
      if (city.isDestroyed) {
        ctx.fillStyle = '#333';
        ctx.fillRect(city.pos.x - 15, city.pos.y - 5, 30, 5);
      } else {
        ctx.fillStyle = '#4a90e2';
        ctx.fillRect(city.pos.x - 15, city.pos.y - 15, 30, 15);
        ctx.fillStyle = '#fff';
        ctx.fillRect(city.pos.x - 10, city.pos.y - 10, 5, 5);
        ctx.fillRect(city.pos.x + 5, city.pos.y - 10, 5, 5);
      }
    });

    // Draw Batteries
    gameState.batteries.forEach(b => {
      if (b.isDestroyed) {
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(b.pos.x, b.pos.y, 10, 0, Math.PI, true);
        ctx.fill();
      } else {
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath();
        ctx.arc(b.pos.x, b.pos.y, 20, 0, Math.PI, true);
        ctx.fill();
        // Barrel
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(b.pos.x, b.pos.y - 10);
        ctx.lineTo(b.pos.x, b.pos.y - 25);
        ctx.stroke();
      }
    });

    // Draw Rockets
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 1;
    gameState.rockets.forEach(r => {
      ctx.beginPath();
      ctx.moveTo(r.start.x, r.start.y);
      ctx.lineTo(r.pos.x, r.pos.y);
      ctx.stroke();
      
      ctx.fillStyle = '#fff';
      ctx.fillRect(r.pos.x - 1, r.pos.y - 1, 2, 2);
    });

    // Draw Player Missiles
    gameState.playerMissiles.forEach(m => {
      ctx.strokeStyle = m.isGravityBomb ? '#a29bfe' : '#44ff44';
      ctx.lineWidth = m.isGravityBomb ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(m.start.x, m.start.y);
      ctx.lineTo(m.pos.x, m.pos.y);
      ctx.stroke();

      // Target X
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m.target.x - 5, m.target.y - 5);
      ctx.lineTo(m.target.x + 5, m.target.y + 5);
      ctx.moveTo(m.target.x + 5, m.target.y - 5);
      ctx.lineTo(m.target.x - 5, m.target.y + 5);
      ctx.stroke();
    });

    // Draw Explosions
    gameState.explosions.forEach(e => {
      const isGravity = e.maxRadius > EXPLOSION_MAX_RADIUS;
      const gradient = ctx.createRadialGradient(e.pos.x, e.pos.y, 0, e.pos.x, e.pos.y, e.radius);
      
      if (isGravity) {
        gradient.addColorStop(0, 'rgba(162, 155, 254, 0.8)');
        gradient.addColorStop(0.6, 'rgba(108, 92, 231, 0.4)');
        gradient.addColorStop(1, 'rgba(108, 92, 231, 0)');
      } else {
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.4, 'rgba(255, 165, 0, 0.6)');
        gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
      }
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(e.pos.x, e.pos.y, e.radius, 0, Math.PI * 2);
      ctx.fill();

      if (isGravity) {
        ctx.strokeStyle = 'rgba(162, 155, 254, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(e.pos.x, e.pos.y, e.radius * 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

  }, [gameState]);

  const startGame = () => {
    setGameState({
      ...INITIAL_STATE,
      status: 'PLAYING',
    });
  };

  const nextLevel = () => {
    setGameState(prev => ({
      ...prev,
      status: 'PLAYING',
      level: prev.level + 1,
      rockets: [],
      playerMissiles: [],
      explosions: [],
      // Batteries are restored per turn as per requirements
      batteries: prev.batteries.map(b => ({
        ...b,
        isDestroyed: false,
        missiles: b.maxMissiles
      }))
    }));
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans flex flex-col items-center justify-center p-4 overflow-hidden">
      {/* Header / HUD */}
      <div className="w-full max-w-[800px] flex justify-between items-end mb-4 px-2">
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold tracking-tighter flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-500" />
            {t.title}
          </h1>
          <div className="text-xs text-zinc-500 font-mono uppercase tracking-widest">
            Defensive Matrix v1.0.4
          </div>
        </div>

        <div className="flex gap-8 items-center">
          <div className="text-right">
            <div className="text-[10px] uppercase text-zinc-500 font-bold tracking-widest">{t.currentLevel}</div>
            <div className="text-2xl font-mono font-bold text-blue-400">
              {gameState.level}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase text-zinc-500 font-bold tracking-widest">{t.score}</div>
            <div className="text-3xl font-mono font-light tracking-tighter text-emerald-400">
              {gameState.score.toString().padStart(5, '0')}
            </div>
          </div>
          <button 
            onClick={() => setLang(l => l === 'zh' ? 'en' : 'zh')}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <Globe className="w-5 h-5 text-zinc-400" />
          </button>
        </div>
      </div>

      {/* Game Container */}
      <div className="relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-emerald-500/20 rounded-xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
        <div className="relative bg-black rounded-lg overflow-hidden border border-white/10 shadow-2xl">
          <canvas
            ref={canvasRef}
            width={GAME_WIDTH}
            height={GAME_HEIGHT}
            onClick={handleCanvasClick}
            onContextMenu={handleContextMenu}
            onTouchStart={handleCanvasClick}
            className="cursor-crosshair w-full h-auto max-h-[70vh] aspect-[4/3]"
          />

          {/* Overlays */}
          <AnimatePresence>
            {gameState.status !== 'PLAYING' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 text-center"
              >
                <motion.div
                  initial={{ scale: 0.9, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  className="max-w-md"
                >
                  {gameState.status === 'START' && (
                    <>
                      <Target className="w-16 h-16 text-blue-500 mx-auto mb-6" />
                      <h2 className="text-4xl font-bold mb-4 tracking-tight">{t.title}</h2>
                      <p className="text-zinc-400 mb-8 leading-relaxed">
                        {t.description}
                        <br />
                        <span className="text-emerald-500/80 text-sm mt-2 block">
                          {t.targetScore}: {WIN_SCORE}
                        </span>
                      </p>
                      <button 
                        onClick={startGame}
                        className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-blue-900/20"
                      >
                        {t.start}
                      </button>
                    </>
                  )}

                  {gameState.status === 'WON' && (
                    <>
                      <Trophy className="w-16 h-16 text-yellow-500 mx-auto mb-6" />
                      <h2 className="text-4xl font-bold mb-2 text-yellow-500">{t.levelComplete}</h2>
                      <div className="text-xl text-zinc-400 mb-2">{t.currentLevel} {gameState.level}</div>
                      <div className="text-5xl font-mono mb-8 text-white">{gameState.score}</div>
                      <button 
                        onClick={nextLevel}
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2"
                      >
                        <RefreshCw className="w-5 h-5" />
                        {t.nextLevel}
                      </button>
                    </>
                  )}

                  {gameState.status === 'LOST' && (
                    <>
                      <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-6" />
                      <h2 className="text-4xl font-bold mb-2 text-red-500">{t.lose}</h2>
                      <div className="text-2xl text-zinc-400 mb-8">{t.score}: {gameState.score}</div>
                      <button 
                        onClick={startGame}
                        className="w-full py-4 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2"
                      >
                        <RefreshCw className="w-5 h-5" />
                        {t.restart}
                      </button>
                    </>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* HUD Overlay - Missile Status */}
          {gameState.status === 'PLAYING' && (
            <div className="absolute bottom-4 left-0 right-0 px-8 flex justify-between pointer-events-none">
              {gameState.batteries.map((b, i) => (
                <div key={b.id} className={`flex flex-col items-center ${b.isDestroyed ? 'opacity-20' : ''}`}>
                  <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-tighter mb-1">
                    {t.missiles}
                  </div>
                  <div className="text-2xl font-mono font-bold text-emerald-500">
                    ∞
                  </div>
                  <div className="flex gap-0.5 mt-1">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <div 
                        key={j} 
                        className="w-1 h-3 rounded-full bg-emerald-500/50"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="mt-8 text-center max-w-md">
        <div className="grid grid-cols-3 gap-4 text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
          <div className="border border-white/5 p-2 rounded">System: Active</div>
          <div className="border border-white/5 p-2 rounded">Target: {gameState.level * WIN_SCORE}</div>
          <div className="border border-white/5 p-2 rounded">Cities: {gameState.cities.filter(c => !c.isDestroyed).length}</div>
        </div>
      </div>
    </div>
  );
}
