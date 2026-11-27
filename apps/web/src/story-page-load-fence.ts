/** Latest request wins; callers also compare the current campaign/era scope.
 * Stale failures must not produce toasts for a different view. */
export function createStoryPageLoadFence(){
 let generation=0;
 return {begin(scope:string){const own=++generation;return (currentScope:string)=>own===generation&&scope===currentScope;},invalidate(){generation++;}};
}
