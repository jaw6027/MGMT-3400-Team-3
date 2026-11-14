import React from "react";
import Svg, { Path, Ellipse, Rect, Circle, G } from "react-native-svg";
export default function Illustration() {
  return (
    <Svg width="260" height="206" viewBox="0 0 280 220">
      <Ellipse cx="143" cy="197" rx="111" ry="12" fill="#D4DFC5" />
      <Path
        d="M65 106Q38 65 62 28Q86 42 86 79Q94 27 116 22Q135 53 109 99"
        fill="#718F61"
      />
      <Path d="M77 112L65 46M86 98L111 39" stroke="#496B48" strokeWidth="2" />
      <G rotation="-13" origin="155,110">
        <Rect x="126" y="22" width="35" height="137" rx="17" fill="#E7BC80" />
        <Path
          d="M133 49L151 41M131 72L149 64M130 95L148 87"
          stroke="#C49861"
          strokeWidth="3"
        />
      </G>
      <Rect x="176" y="74" width="40" height="84" rx="6" fill="#F9FAF1" />
      <Path d="M177 74L188 57H207L216 74Z" fill="#B5CAA4" />
      <Path d="M188 57V74H216" fill="#DCE8D3" />
      <Path d="M193 93Q184 107 196 112Q212 108 200 93" fill="#78996B" />
      <Circle cx="116" cy="119" r="30" fill="#DA9273" />
      <Path d="M113 89Q105 74 122 75L119 88" fill="#5E8356" />
      <Circle cx="156" cy="122" r="25" fill="#B9C66F" />
      <Path
        d="M51 118H229L211 190Q208 199 198 199H83Q74 199 71 188Z"
        fill="#E7D6A7"
      />
      <Path
        d="M65 134H219M72 153H216M76 174H211M95 122L104 193M125 122L129 196M155 122L154 196M186 122L177 196M213 122L200 191"
        stroke="#C8B984"
        strokeWidth="2"
      />
      <Rect x="47" y="113" width="187" height="13" rx="6" fill="#80976B" />
      <Path
        d="M92 117Q93 63 141 64Q185 64 188 117"
        stroke="#53774C"
        strokeWidth="8"
        fill="none"
      />
      <Circle cx="239" cy="48" r="17" fill="#FAFCF5" />
      <Path
        d="M232 48L237 53 246 43"
        stroke="#65895A"
        strokeWidth="2"
        fill="none"
      />
      <Path
        d="M36 85L38 91 44 93 38 95 36 101 34 95 28 93 34 91Z"
        fill="#9FB78D"
      />
      <Circle cx="218" cy="26" r="3" fill="#B4C59E" />
    </Svg>
  );
}
