type Operation = "select" | "update" | "insert" | "delete";

export type QueryRecord = {
  input?: unknown;
  fromArg?: unknown;
  joinArgs: unknown[][];
  whereArgs: unknown[][];
  orderByArgs: unknown[][];
  limitArgs: unknown[][];
  setArg?: unknown;
  valuesArg?: unknown;
  returningCalled: boolean;
};

export type MockDbConfig = {
  select?: unknown[];
  update?: unknown[];
  insert?: unknown[];
  delete?: unknown[];
  execute?: unknown[];
  transactions?: MockDbConfig[];
};

export type MockDbHandle = {
  db: any;
  history: {
    selects: QueryRecord[];
    updates: QueryRecord[];
    inserts: QueryRecord[];
    deletes: QueryRecord[];
    executes: unknown[];
    transactions: MockDbHandle[];
  };
};

function cloneQueue(values: unknown[] | undefined) {
  return values ? [...values] : [];
}

function createRecord(input?: unknown): QueryRecord {
  return {
    input,
    joinArgs: [],
    whereArgs: [],
    orderByArgs: [],
    limitArgs: [],
    returningCalled: false,
  };
}

function buildThenable(record: QueryRecord, result: unknown) {
  const builder = {
    from(arg: unknown) {
      record.fromArg = arg;
      return builder;
    },
    innerJoin(...args: unknown[]) {
      record.joinArgs.push(args);
      return builder;
    },
    leftJoin(...args: unknown[]) {
      record.joinArgs.push(args);
      return builder;
    },
    where(...args: unknown[]) {
      record.whereArgs.push(args);
      return builder;
    },
    orderBy(...args: unknown[]) {
      record.orderByArgs.push(args);
      return builder;
    },
    limit(...args: unknown[]) {
      record.limitArgs.push(args);
      return builder;
    },
    set(value: unknown) {
      record.setArg = value;
      return builder;
    },
    values(value: unknown) {
      record.valuesArg = value;
      return builder;
    },
    returning() {
      record.returningCalled = true;
      return Promise.resolve(result);
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };

  return builder;
}

export function createMockDb(config: MockDbConfig = {}): MockDbHandle {
  const queues = {
    select: cloneQueue(config.select),
    update: cloneQueue(config.update),
    insert: cloneQueue(config.insert),
    delete: cloneQueue(config.delete),
    execute: cloneQueue(config.execute),
    transactions: cloneQueue(config.transactions),
  };

  const history: MockDbHandle["history"] = {
    selects: [],
    updates: [],
    inserts: [],
    deletes: [],
    executes: [],
    transactions: [],
  };

  function shiftResult(operation: Operation | "execute") {
    const queue = queues[operation];
    if (queue.length === 0) {
      return operation === "execute" ? undefined : [];
    }
    return queue.shift();
  }

  function createQuery(operation: Operation, input?: unknown) {
    const record = createRecord(input);
    const result = shiftResult(operation);
    if (operation === "select") history.selects.push(record);
    if (operation === "update") history.updates.push(record);
    if (operation === "insert") history.inserts.push(record);
    if (operation === "delete") history.deletes.push(record);
    return buildThenable(record, result);
  }

  const db = {
    select(input?: unknown) {
      return createQuery("select", input);
    },
    update(input?: unknown) {
      return createQuery("update", input);
    },
    insert(input?: unknown) {
      return createQuery("insert", input);
    },
    delete(input?: unknown) {
      return createQuery("delete", input);
    },
    execute(statement: unknown) {
      history.executes.push(statement);
      return Promise.resolve(shiftResult("execute"));
    },
    async transaction<T>(callback: (tx: any) => Promise<T> | T): Promise<T> {
      const tx = createMockDb((queues.transactions.shift() as MockDbConfig | undefined) ?? {});
      history.transactions.push(tx);
      return callback(tx.db);
    },
  };

  return { db, history };
}
