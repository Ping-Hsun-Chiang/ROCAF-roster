-- 資格改為兩種：哨長（可兼任槍兵）/ 僅槍兵。原「皆可」併入哨長。
update members set qualification = 'leader' where qualification = 'both';
alter table members alter column qualification set default 'leader';
