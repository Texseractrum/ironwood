import {addStock,type Stock} from './data';
import {freshProgress,type Progress,type SharedWorld,type WorldProfile} from './open-world';
import {TEAM_DISTANCE,CLAN_LIMIT,type ClanAction,type TeamInvite,type ClanSummary} from './protocol';
import {advanceChapters,migrateCampaign} from './progression';

export interface Clan {id:string;name:string;inventory:Stock;progress:Progress}

export class Clans {
  saved=new Map<string,Clan>();
  invites=new Map<string,TeamInvite>();
  constructor(private world:SharedWorld){}
  resources(p:WorldProfile):WorldProfile|Clan{return (p.clanId&&this.saved.get(p.clanId))||p;}
  allied(p:WorldProfile,id:string|undefined){
    const other=id&&this.world.profiles.get(id);
    return id===p.id||!!(other&&p.clanId&&this.saved.has(p.clanId)&&p.clanId===other.clanId);
  }
  members(p:WorldProfile){return [...this.world.profiles.values()].filter(other=>this.allied(p,other.id));}
  summary(p:WorldProfile,online:Set<string>):ClanSummary|undefined {
    const clan=p.clanId&&this.saved.get(p.clanId);if(!clan)return;
    return {id:clan.id,name:clan.name,members:this.members(p).map(m=>({id:m.id,name:m.name,base:m.base,online:online.has(m.id)}))};
  }
  prune(online:Set<string>,now=Date.now()){
    for(const [id,invite] of this.invites){
      const a=this.world.profiles.get(invite.fromId),b=this.world.profiles.get(invite.toId);
      if(!a||!b||invite.expires<=now||!online.has(a.id)||!online.has(b.id)||a.clanId!==invite.fromClanId||b.clanId!==invite.toClanId||Math.hypot(a.x-b.x,a.z-b.z)>TEAM_DISTANCE)this.invites.delete(id);
    }
  }
  action(p:WorldProfile,action:ClanAction,online:Set<string>,now=Date.now()):string {
    this.prune(online,now);
    if(!online.has(p.id))return 'Reconnect before teaming up.';
    if(action.type==='team-invite'){
      const other=this.world.profiles.get(action.targetId);
      if(!other||other.id===p.id||!online.has(other.id))return 'Choose another engineer who is online.';
      if(Math.hypot(p.x-other.x,p.z-other.z)>TEAM_DISTANCE)return 'Walk within 3 tiles of this engineer to team up.';
      if(this.allied(p,other.id))return 'You are already in the same clan.';
      if(p.clanId&&other.clanId)return 'You already belong to different clans.';
      if(Math.max(this.members(p).length,this.members(other).length)>=CLAN_LIMIT)return 'This clan is full (8 engineers).';
      if([...this.invites.values()].some(i=>(i.fromId===p.id&&i.toId===other.id)||(i.fromId===other.id&&i.toId===p.id)))return 'An invitation is already pending between you.';
      // One outgoing invitation per engineer bounds pending state and duplicate clicks.
      for(const [id,i] of this.invites)if(i.fromId===p.id)this.invites.delete(id);
      const invite:TeamInvite={id:crypto.randomUUID(),fromId:p.id,toId:other.id,expires:now+60000,fromClanId:p.clanId,toClanId:other.clanId};
      this.invites.set(invite.id,invite);return `Team invitation sent to ${other.name}.`;
    }
    const invite=this.invites.get(action.inviteId);
    if(!invite)return 'This invitation expired. Meet nearby to try again.';
    if(action.type==='team-cancel'){
      if(invite.fromId!==p.id)return 'Only the sender can cancel this invitation.';
      this.invites.delete(invite.id);return 'Team invitation cancelled.';
    }
    if(invite.toId!==p.id)return 'This invitation is for another engineer.';
    if(action.type==='team-decline'){this.invites.delete(invite.id);return 'Team invitation declined.';}
    const other=this.world.profiles.get(invite.fromId)!;
    if(this.allied(p,other.id)||(p.clanId&&other.clanId))return 'Your clan membership changed. Send a new invitation.';
    if(Math.max(this.members(p).length,this.members(other).length)>=CLAN_LIMIT)return 'This clan is full (8 engineers).';
    let clan=(p.clanId&&this.saved.get(p.clanId))||(other.clanId&&this.saved.get(other.clanId));
    if(!clan){clan={id:crypto.randomUUID(),name:`${other.name}’s clan`,inventory:{},progress:freshProgress()};this.saved.set(clan.id,clan);}
    for(const member of [other,p]){
      if(member.clanId===clan.id)continue;
      // Transfer each personal pack exactly once; the clan owns the only pooled balance.
      addStock(clan.inventory,member.inventory);member.inventory={};
      const progress=clan.progress,personal=member.progress;
      migrateCampaign(progress);migrateCampaign(personal);
      progress.campaign.badges=[...new Set([...progress.campaign.badges,...personal.campaign.badges])];
      progress.campaign.mastery||=personal.campaign.mastery;
      if(personal.campaign.completedAt!==null){progress.campaign.completedAt=progress.campaign.completedAt===null?personal.campaign.completedAt:Math.min(progress.campaign.completedAt,personal.campaign.completedAt);progress.campaign.completionSeen=false;}
      addStock(progress.produced,personal.produced);progress.unlock=Math.max(progress.unlock,personal.unlock);
      progress.delivered+=personal.delivered;progress.built+=personal.built;progress.gathered+=personal.gathered;
      progress.deliveryEvents.push(...personal.deliveryEvents);progress.won||=personal.won;
      member.progress=freshProgress();member.clanId=clan.id;
    }
    const state={...this.world.sim.state,...clan.progress,inventory:clan.inventory,owner:p.id,clanMembers:this.members(p).map(m=>m.id)};
    advanceChapters(state);clan.progress.unlock=state.unlock;
    this.world.resetChallenge(p);this.world.sim.revision++;
    this.prune(online,now);
    return `Joined ${clan.name}. Your supplies and workshops are now shared.`;
  }
}
