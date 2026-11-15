import { compileRequest, variablesFor } from './models';
import type { Collection, Environment, NativeCollection, RequestItem } from './models';

export function prepareCollection(
  collection: Collection,
  environment: Environment,
  requests: RequestItem[],
  stopOnFailure: boolean,
): NativeCollection {
  const variables = variablesFor(collection, environment);
  return {
    variables,
    stop_on_failure: stopOnFailure,
    requests: requests.map((item) => {
      const step = { name: item.name, tests: item.tests, extract: item.extract };
      try {
        return { ...step, request: compileRequest(item, collection, variables, false, true) };
      } catch (error) {
        return {
          ...step,
          preparation_error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  };
}
