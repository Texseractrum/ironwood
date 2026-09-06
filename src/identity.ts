/** Public identity supplied by the server after X authentication. Never a credential. */
export interface XProfile {
  id:string;
  username:string;
  name:string;
  avatarUrl?:string;
  verified:boolean;
  verifiedType:'blue'|'business'|'government'|'none';
  affiliation?:{name:string;userId?:string;username?:string;badgeUrl:string};
}

export function profileImage(value:unknown):string|undefined {
  if(typeof value!=='string'||value.length>2048)return;
  try {
    const url=new URL(value);
    if(url.protocol==='https:'&&url.hostname==='pbs.twimg.com'&&!url.username&&!url.password)return url.href;
  }catch{/* Missing or unsupported images use the initials fallback. */}
}

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const label=(value:unknown,max=80)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max):'';

/** X's affiliation object is optional; its expanded organisation provides a fallback image. */
export function parseXProfile(payload:unknown):XProfile {
  const response=record(payload),user=record(response.data);
  if(typeof user.id!=='string'||!/^\d{1,30}$/.test(user.id)||!label(user.name)||typeof user.username!=='string'||!/^\w{1,50}$/.test(user.username))throw new Error('X did not return a valid profile.');
  const verifiedType=user.verified_type==='blue'||user.verified_type==='business'||user.verified_type==='government'?user.verified_type:'none';
  const profile:XProfile={id:user.id,username:user.username,name:label(user.name),avatarUrl:profileImage(user.profile_image_url),verified:user.verified===true||verifiedType!=='none',verifiedType};
  const affiliation=record(user.affiliation),includes=record(response.includes);
  const users=Array.isArray(includes.users)?includes.users.map(record):[];
  const organisation=users.find(item=>typeof affiliation.user_id==='string'&&item.id===affiliation.user_id);
  const badgeUrl=profileImage(affiliation.badge_url)||profileImage(organisation?.profile_image_url);
  if(badgeUrl)profile.affiliation={name:label(affiliation.description)||label(organisation?.name)||'Affiliated organisation',userId:typeof affiliation.user_id==='string'?affiliation.user_id:undefined,username:label(organisation?.username)||undefined,badgeUrl};
  return profile;
}
