import { compareModels } from './comparison.mjs';
import { fitEnsemble } from './extremes.mjs';
self.onmessage = ({ data }) => {
  try {
    const run = data.kind === 'comparison' ? compareModels : fitEnsemble;
    const result = run(
      data.kind === 'comparison' ? data.blocks : data.values,
      data.options,
      (progress) => self.postMessage({ progress }),
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
