declare module 'draco3d/draco_decoder_nodejs.js' {
  import type { DracoModule } from '@core/model/draco';
  const createDecoderModule: (opts?: { wasmBinary?: ArrayBuffer }) => Promise<DracoModule>;
  export default createDecoderModule;
}

declare module 'draco3d/draco_encoder_nodejs.js' {
  const createEncoderModule: (opts?: object) => Promise<unknown>;
  export default createEncoderModule;
}
