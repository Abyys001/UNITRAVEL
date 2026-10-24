import 'identity.dart';
import 'json.dart';
import 'requests.dart';

/// `GET /v1/me/details`: profile, optional address, contact methods and the account holder's own traveller.
class MyDetails {
  const MyDetails({
    required this.givenNamesLatin,
    required this.surnameLatin,
    required this.nameFa,
    required this.contactTimePref,
    required this.address,
    required this.identities,
    required this.self,
  });

  final String? givenNamesLatin;
  final String? surnameLatin;
  final String? nameFa;
  final String? contactTimePref;
  final Address? address;
  final List<ContactMethod> identities;
  final Traveller? self;

  factory MyDetails.fromJson(Json j) {
    final a = j.objOrNull('address');
    final self = j.objOrNull('self');
    return MyDetails(
      givenNamesLatin: j.strOrNull('givenNamesLatin'),
      surnameLatin: j.strOrNull('surnameLatin'),
      nameFa: j.strOrNull('nameFa'),
      contactTimePref: j.strOrNull('contactTimePref'),
      address: a == null
          ? null
          : Address(line1: a.str('line1'), line2: a.strOrNull('line2'), city: a.str('city'), postcode: a.str('postcode'), country: a.str('country')),
      identities: [
        for (final i in j.objs('identities'))
          ContactMethod(id: i.str('id'), type: i.str('type'), value: i.str('value'), verified: i.flag('verified')),
      ],
      self: self == null ? null : Traveller.fromJson(self),
    );
  }
}
