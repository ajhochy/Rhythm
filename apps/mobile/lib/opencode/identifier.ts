import { getRandomBytes } from 'expo-crypto';

const RANDOM_LENGTH = 14;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
let lastTimestamp = 0;
let counter = 0;

export function createOpenCodeMessageId(): string {
  const currentTimestamp = Date.now();
  if (currentTimestamp !== lastTimestamp) {
    lastTimestamp = currentTimestamp;
    counter = 0;
  }
  counter += 1;

  const encodedTimestamp = (
    BigInt(currentTimestamp) * BigInt(0x1000)
    + BigInt(counter)
  ) & BigInt('0xffffffffffff');
  const random = [...getRandomBytes(RANDOM_LENGTH)]
    .map((value) => BASE62[value % BASE62.length])
    .join('');
  return `msg_${encodedTimestamp.toString(16).padStart(12, '0')}${random}`;
}
