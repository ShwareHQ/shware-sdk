/**
 * A distributed unique ID generator inspired by Twitter's Snowflake.
 *
 * ID data bits:
 * +----------------------+----------------+-----------+
 * |  delta millisecond   | worker node id | sequence  |
 * +----------------------+----------------+-----------+
 * |        41bits        |     10bits     |   12bits  |
 * +----------------------+----------------+-----------+
 *
 */

function getNextMillisecond(timestamp: bigint) {
  let now = BigInt(Date.now());
  while (now < timestamp) {
    now = BigInt(Date.now());
  }
  return now;
}

export class UidGenerator {
  public readonly MAX = (1n << 63n) - 1n;
  private readonly workerBits = BigInt(10);
  private readonly sequenceBits = BigInt(12);
  private readonly epochMillisecond = BigInt(1577808000000); // 2020-1-1 00:00:00
  private readonly sequenceMask = ~(BigInt(-1) << this.sequenceBits);
  private readonly maxWorkerId = ~(BigInt(-1) << this.workerBits);
  private readonly workerIdShift = this.sequenceBits;
  private readonly timeStampShift = this.workerBits + this.sequenceBits;
  private readonly workerId: bigint;
  private sequence = BigInt(0);
  private lastTimestamp = BigInt(-1);

  constructor(workerId: number) {
    this.workerId = BigInt(workerId) % this.maxWorkerId;
  }

  public readonly next = (): bigint => {
    let timestamp = BigInt(Date.now());
    if (timestamp < this.lastTimestamp) {
      console.error(`Clock moved backwards. time gap = ${this.lastTimestamp - timestamp}`);
      timestamp = getNextMillisecond(this.lastTimestamp);
    }
    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + BigInt(1)) & this.sequenceMask;
      if (this.sequence === BigInt(0)) {
        timestamp = getNextMillisecond(timestamp);
      }
    } else {
      this.sequence = BigInt(0);
    }
    this.lastTimestamp = timestamp;
    return (
      ((timestamp - this.epochMillisecond) << this.timeStampShift) |
      (this.workerId << this.workerIdShift) |
      this.sequence
    );
  };
}

const workerId = Math.floor(Math.random() * 1024);
export const uid = new UidGenerator(workerId);
