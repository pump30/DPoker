declare module 'pokersolver' {
  class Hand {
    static solve(cards: string[]): Hand;
    static winners(hands: Hand[]): Hand[];
    name: string;
    descr: string;
  }
  const _default: { Hand: typeof Hand };
  export default _default;
  export { Hand };
}
