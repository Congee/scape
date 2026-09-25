/** Which sky layers a frame may draw for a given Sun altitude. */

import { smooth } from './palette';

/** How dark the sky is for stars, 0 by day (Sun above −4°) to 1 in astronomical night. */
export const starNight = (sunAltDeg: number) => smooth(-4, -14, sunAltDeg);
