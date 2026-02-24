
export interface Point {
  x: number;
  y: number;
}

export interface Entity {
  id: string;
  pos: Point;
}

export interface Rocket extends Entity {
  start: Point;
  target: Point;
  progress: number; // 0 to 1
  speed: number;
}

export interface PlayerMissile extends Entity {
  start: Point;
  target: Point;
  progress: number;
  speed: number;
  originBatteryIndex: number;
  isGravityBomb?: boolean;
}

export interface Explosion extends Entity {
  radius: number;
  maxRadius: number;
  life: number; // 0 to 1
  isExpanding: boolean;
}

export interface City extends Entity {
  isDestroyed: boolean;
}

export interface Battery extends Entity {
  missiles: number;
  maxMissiles: number;
  isDestroyed: boolean;
}

export type GameStatus = 'START' | 'PLAYING' | 'WON' | 'LOST';

export interface GameState {
  score: number;
  status: GameStatus;
  cities: City[];
  batteries: Battery[];
  rockets: Rocket[];
  playerMissiles: PlayerMissile[];
  explosions: Explosion[];
  level: number;
}
