import { fitEnsemble } from './extremes.mjs';
self.onmessage = ({ data }) => {
  try {
    const result = fitEnsemble(data.values, data.options, (progress) =>
      self.postMessage({ progress }),
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
