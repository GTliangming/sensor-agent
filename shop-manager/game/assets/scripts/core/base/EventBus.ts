// 极简的强类型事件总线:系统之间通过事件通信,不互相直接调用。
// 用法:const bus = new EventBus<{ ping: { n: number } }>(); bus.on('ping', e => ...); bus.emit('ping', { n: 1 });
//
// 注意:这里刻意用数组而不是 Set 来存处理函数。
// 微信小游戏的构建会把代码降级编译,对 Set/Map 做 `[...set]` 或 for-of 会被错误地编译成"把整个 Set 当作一个元素",
// 在浏览器预览里正常、到微信里才报 "is not a function"。core 层统一避免对 Set/Map 做展开和 for-of 遍历。

type Handler = (payload: never) => void;

export class EventBus<E extends object> {
    private readonly handlers = new Map<keyof E, Handler[]>();

    /** 订阅事件,返回取消订阅函数。 */
    on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): () => void {
        let list = this.handlers.get(event);
        if (!list) {
            list = [];
            this.handlers.set(event, list);
        }
        const h = handler as Handler;
        list.push(h);
        return () => {
            const i = list!.indexOf(h);
            if (i >= 0) list!.splice(i, 1);
        };
    }

    emit<K extends keyof E>(event: K, payload: E[K]): void {
        const list = this.handlers.get(event);
        if (!list) return;
        // 复制一份再遍历,允许处理函数里取消订阅
        const snapshot = list.slice();
        for (let i = 0; i < snapshot.length; i++) (snapshot[i] as (p: E[K]) => void)(payload);
    }
}
