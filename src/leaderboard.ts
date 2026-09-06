import type {XProfile} from './identity';
import type {SharedWorld} from './open-world';
import {total} from './data';

export const LEADERBOARD_PAGE_SIZE=50;
export interface LeaderboardEntry {
  rank:number;
  playerId:string;
  profile:XProfile;
  totalMaterials:number;
  clan?:string;
}
export interface LeaderboardPage {
  entries:LeaderboardEntry[];
  total:number;
  page:number;
  pages:number;
  own:LeaderboardEntry|null;
}

/** Only server-linked X identities qualify. Online presence and paid verification are irrelevant. */
export function leaderboard(world:SharedWorld,accountId?:string,requestedPage=1):LeaderboardPage {
  const entries:LeaderboardEntry[]=[];
  for(const p of world.profiles.values()){
    if(!p.xProfile)continue;
    const resources=world.clans.resources(p);
    entries.push({rank:0,playerId:p.id,profile:p.xProfile,totalMaterials:total(resources.inventory),clan:p.clanId?world.clans.saved.get(p.clanId)?.name:undefined});
  }
  // Stable account IDs keep tied rows in the same order across handle changes and restarts.
  entries.sort((a,b)=>b.totalMaterials-a.totalMaterials||(a.profile.id<b.profile.id?-1:a.profile.id>b.profile.id?1:0));
  for(let i=0;i<entries.length;i++)entries[i].rank=i>0&&entries[i].totalMaterials===entries[i-1].totalMaterials?entries[i-1].rank:i+1;
  const pages=Math.max(1,Math.ceil(entries.length/LEADERBOARD_PAGE_SIZE));
  const page=Math.min(pages,Math.max(1,Number.isSafeInteger(requestedPage)?requestedPage:1));
  return {entries:entries.slice((page-1)*LEADERBOARD_PAGE_SIZE,page*LEADERBOARD_PAGE_SIZE),total:entries.length,page,pages,own:entries.find(entry=>entry.profile.id===accountId)??null};
}
