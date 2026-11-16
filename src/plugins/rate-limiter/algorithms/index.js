import { consumeFixedWindow } from './fixed-window.js';
import { consumeSlidingWindowLog } from './sliding-window-log.js';
import { consumeSlidingWindowCounter } from './sliding-window-counter.js';
import { consumeTokenBucket } from './token-bucket.js';
import { consumeLeakyBucket } from './leaky-bucket.js';

export const algorithms = Object.freeze({
  'fixed-window': consumeFixedWindow,
  'sliding-window-log': consumeSlidingWindowLog,
  'sliding-window-counter': consumeSlidingWindowCounter,
  'token-bucket': consumeTokenBucket,
  'leaky-bucket': consumeLeakyBucket
});

export const algorithmNames = Object.freeze(Object.keys(algorithms));
export { consumeFixedWindow, consumeSlidingWindowLog, consumeSlidingWindowCounter, consumeTokenBucket, consumeLeakyBucket };
