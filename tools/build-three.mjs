import {build} from 'esbuild';

await build({entryPoints:['node_modules/three/build/three.module.js'],bundle:true,minify:true,format:'esm',outfile:'static/vendor/three.module.min.js'});
await build({
  entryPoints:['node_modules/three/examples/jsm/loaders/GLTFLoader.js'],
  bundle:true,minify:true,format:'esm',outfile:'static/vendor/GLTFLoader.js',
  plugins:[{name:'shared-three',setup(builder){
    builder.onResolve({filter:/^three$/},()=>({path:'./three.module.min.js',external:true}));
  }}],
});
