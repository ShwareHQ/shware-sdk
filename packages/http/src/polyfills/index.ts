// @ts-expect-error fixed: Do not know how to serialize a BigInt
BigInt.prototype.toJSON = function () {
  return this.toString();
};
