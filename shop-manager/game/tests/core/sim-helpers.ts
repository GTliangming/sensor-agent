import { GameSession } from '../../assets/scripts/core/GameSession';
import { createInitialState } from '../../assets/scripts/core/state/GameState';
import { DEFAULT_CLOCK_CONFIG } from '../../assets/scripts/core/time/GameClock';
import { TUTORIAL_STEP_COUNT } from '../../assets/scripts/core/tutorial/Tutorial';

const CFG = { ...DEFAULT_CLOCK_CONFIG, dayLengthSec: 240 };

/** 引导已完成、没有随机顾客干扰的会话(默认没开门,不会自动来顾客)。 */
export function newSession(seed = 7): GameSession {
    const s = createInitialState(seed);
    s.tutorial = { step: TUTORIAL_STEP_COUNT, moved: true };
    return new GameSession(s, CFG);
}

/** 手工放一位正在逛店的顾客(想买 itemId × units),很快逛完。 */
export function addShopper(g: GameSession, itemId: string, units = 1, timer = 0.1): number {
    const id = g.state.nextCustomerId++;
    g.state.customers.push({ id, phase: 'browsing', timer, waited: 0, wants: [{ itemId, units }], cart: [], scanned: false, joinSeq: 0 });
    return id;
}
