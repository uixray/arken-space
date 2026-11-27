import {afterEach,expect,it,vi} from "vitest";
import {watchCacheValidity} from "./cache-validity-watch";
let stop:(()=>void)|undefined;
afterEach(()=>{stop?.();stop=undefined;vi.useRealTimers();});
it("rechecks expiry or deletion and invalidates only once",async()=>{
 vi.useFakeTimers();const check=vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false),invalidated=vi.fn();
 stop=watchCacheValidity(check,invalidated);await vi.advanceTimersByTimeAsync(0);expect(invalidated).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1000);expect(invalidated).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(5000);expect(invalidated).toHaveBeenCalledOnce();
});
it("ignores a late result after disposal and does not overlap database checks",async()=>{
 vi.useFakeTimers();let finish!:(valid:boolean)=>void;const check=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;})),invalidated=vi.fn();
 stop=watchCacheValidity(check,invalidated);await vi.advanceTimersByTimeAsync(5000);expect(check).toHaveBeenCalledOnce();stop();finish(false);await Promise.resolve();expect(invalidated).not.toHaveBeenCalled();
});
it("closes the view when current storage validity cannot be confirmed",async()=>{
 vi.useFakeTimers();const invalidated=vi.fn();stop=watchCacheValidity(vi.fn().mockRejectedValue(Error("PRIVATE DB")),invalidated);
 await vi.advanceTimersByTimeAsync(0);expect(invalidated).toHaveBeenCalledOnce();
});
