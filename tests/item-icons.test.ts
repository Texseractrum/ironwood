import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ITEMS,type Item} from '../src/data';
import {itemIconUrl} from '../src/item-icons';

test('every item has a distinct transparent portrait and a self-contained 3D model',()=>{
  const portraits=new Set<string>();
  for(const item of Object.keys(ITEMS) as Item[]){
    const png=readFileSync(new URL('../public'+itemIconUrl(item),import.meta.url));
    assert.equal(png.subarray(1,4).toString(),'PNG',item);
    assert.equal(png.readUInt32BE(16),192,item);
    assert.equal(png.readUInt32BE(20),192,item);
    assert.equal(png[25],6,`${item} needs RGBA transparency`);
    const hash=createHash('sha256').update(png).digest('hex');
    assert.ok(!portraits.has(hash),`${item} must have its own artwork`);
    portraits.add(hash);
    const glb=readFileSync(new URL(`../public/assets/models/items/${item}.glb`,import.meta.url));
    assert.equal(glb.subarray(0,4).toString(),'glTF',item);
    assert.equal(glb.readUInt32LE(8),glb.length,item);
    const model=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString());
    assert.ok(model.meshes?.length,`${item} must contain geometry`);
    assert.equal(model.scenes.length,1,`${item} must not include other Blender scenes`);
    assert.ok(!model.nodes.some((node:{name?:string})=>node.name==='Cube'),`${item} must not contain Blender's default cube`);
    assert.ok((model.images??[]).every((image:{uri?:string;bufferView?:number})=>image.uri===undefined&&image.bufferView!==undefined),`${item} textures must be embedded`);
  }
});
