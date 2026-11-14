/**
 * A distributed unique ID generator inspired by Twitter's Snowflake.
 *
 * ID data bits:
 * +----------------------+----------------+-----------+
 * |  delta millisecond   |   machine id   | sequence  |
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
  private readonly machineBits = BigInt(10);
  private readonly sequenceBits = BigInt(12);
  private readonly epochMillisecond = BigInt(1577808000000); // 2020-1-1 00:00:00
  private readonly sequenceMask = ~(BigInt(-1) << this.sequenceBits);
  private readonly maxMachineId = ~(BigInt(-1) << this.machineBits);
  private readonly machineIdShift = this.sequenceBits;
  private readonly timeStampShift = this.machineBits + this.sequenceBits;
  private readonly machineId: bigint;
  private sequence = BigInt(0);
  private lastTimestamp = BigInt(-1);

  constructor(machineId: number) {
    this.machineId = BigInt(machineId) % this.maxMachineId;
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
      (this.machineId << this.machineIdShift) |
      this.sequence
    );
  };
}

/**
 * A ready-made generator whose machine id is drawn at random (0-1023) once per isolate, so its ids
 * are unique within one isolate but may collide across isolates (several Workers, Lambdas or
 * processes) that generate in the same millisecond. A multi-instance deployment should construct
 * its own `UidGenerator` with a machine id assigned per instance.
 */
export const uid = new UidGenerator(Math.floor(Math.random() * 1024));
