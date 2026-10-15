import {sqliteTable,text,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const accounts=sqliteTable('accounts',{id:text('id').primaryKey(),name:text('name').notNull(),data:text('data').notNull()},t=>[uniqueIndex('idx_accounts_name').on(t.name)]);
export const signals=sqliteTable('signals',{id:text('id').primaryKey(),data:text('data').notNull()});
export const handoffs=sqliteTable('handoffs',{id:text('id').primaryKey(),accountId:text('account_id').notNull().references(()=>accounts.id),data:text('data').notNull()});
export const feedback=sqliteTable('feedback',{id:text('id').primaryKey(),handoffId:text('handoff_id').notNull().references(()=>handoffs.id),data:text('data').notNull()});
export const rules=sqliteTable('rules',{id:text('id').primaryKey(),data:text('data').notNull()});
export const stateMeta=sqliteTable('state_meta',{id:text('id').primaryKey(),data:text('data').notNull()});
