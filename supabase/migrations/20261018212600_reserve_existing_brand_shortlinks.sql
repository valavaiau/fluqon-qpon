alter table fluqon_private.offers add constraint offers_reserved_slugs check(id not in ('fluq','jb80','nike30','dock47','fresh20','iconic25','first15'));
